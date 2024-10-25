// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
const DynamoDBService = require('./services/DynamoDBService.mjs');
const BedrockService = require('./services/BedrockService.mjs');
const PinpointService = require('./services/PinpointService.mjs');
const WhatsAppService = require('./services/WhatsAppService.mjs');
const xss = require("xss") //https://github.com/leizongmin/js-xss

const restartKeywords = ['restart','begin','commence','initiate','launch','commence','start','demo','go','reset', 'clear']

//Helper Functions
const sendResponse = async (channel, inboundMessage, outboundMessage, knowledgeBaseId, source, sessionId=undefined) => {
    
    let outboundMessageId = ''
    if (channel === 'whatsapp') {
        await WhatsAppService.markMessageAsRead(inboundMessage.inboundMessageId)
        let whatsAppResponse = await WhatsAppService.sendWhatsAppMessage(inboundMessage.originationNumber, outboundMessage)
        outboundMessageId = whatsAppResponse?.messageId
    } else {
        let pinpointResponse = await PinpointService.sendSMS(inboundMessage.originationNumber, outboundMessage);
        outboundMessageId = pinpointResponse?.MessageId
    }

    //Write inbound request to DynamoDB
    const inboundParams = {
        phoneNumber: inboundMessage.originationNumber,
        messageId: inboundMessage.inboundMessageId,
        channel: channel,
        timestamp: Date.now(),
        message: xss(inboundMessage.messageBody), 
        originationNumberId: process.env.EUM_PHONE_NUMBER_ID,
        direction: 'inbound',
        previousPublishedMessageId: inboundMessage.previousPublishedMessageId,
        sessionId: sessionId,
        source: source,
        knowledgeBaseId: knowledgeBaseId,
        ttl: (Date.now() / 1000) + parseInt(process.env.SESSION_SECONDS)
    }
    const putInboundResults = await DynamoDBService.put(process.env.CONTEXT_DYNAMODB_TABLE,inboundParams);
    console.debug('putInboundResults: ', putInboundResults);

    //Write outbound request to DynamoDB
    const outboundParams = {
        phoneNumber: inboundMessage.originationNumber,
        messageId: outboundMessageId, 
        channel: channel,
        timestamp: Date.now(),
        message: xss(outboundMessage), //probably don't need to sanitize response from BR, but why not?
        originationNumberId: process.env.EUM_PHONE_NUMBER_ID,
        direction: 'outbound',
        previousPublishedMessageId: inboundMessage.previousPublishedMessageId,
        sessionId: sessionId,
        source: source,
        knowledgeBaseId: knowledgeBaseId,
        ttl: (Date.now() / 1000) + parseInt(process.env.SESSION_SECONDS)
    }
    const putOutboundResults = await DynamoDBService.put(process.env.CONTEXT_DYNAMODB_TABLE, outboundParams);
    console.debug('putOutboundResults: ', putOutboundResults);

}

const getConversation = async (phoneNumber, channel) => {
    try {
        let params = {
            TableName : process.env.CONTEXT_DYNAMODB_TABLE,
            IndexName: "PhoneIndex",
            KeyConditionExpression: "phoneNumber = :phoneNumber",
            ExpressionAttributeValues: {
                ":phoneNumber": phoneNumber
            },
            FilterExpression: "channel = :channel",
            ExpressionAttributeValues: {
                ":channel": channel
            }
        }
        const getConversationResults = await DynamoDBService.query(params);
        console.debug('Get Conversation Results: ', getConversationResults);
        console.debug(JSON.stringify(getConversationResults, null, 2))
        console.debug(getConversationResults.length)
        return getConversationResults
    }
    catch (error) {
        console.error(error);
        return false
    }

}

const formatConversation = (conversation) => {
    let formattedConversation = []
    for (let i = 0; i < conversation.length; i++) {
        if (conversation[i].direction === "outbound") {
            formattedConversation.push({"role": "assistant", "content": conversation[i].message});
        } else {
            formattedConversation.push({"role": "user", "content": conversation[i].message});
        }
    }
    return formattedConversation;
}

exports.handler = async (event, context, callback) => {

    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.trace(`Event: `, JSON.stringify(event,null,2));

        for (const record of event.Records) {
            console.trace(`Record: `, record);
            let snsMessage = JSON.parse(record.Sns.Message)
            let message = {}
            console.trace(`Message: `, snsMessage);

            let channel = 'sms'
            console.log(record.Sns.TopicArn)
            if (record.Sns.TopicArn === process.env.WHATSAPP_SNS_TOPIC_ARN) {
                channel = 'whatsapp'
                let whatsappMessage = JSON.parse(snsMessage.whatsAppWebhookEntry)
                try {
                    if (whatsappMessage.changes[0]?.value?.messages[0]?.text?.body) { //We have an inbound message
                        message.originationNumber = '+' + whatsappMessage.changes[0].value?.messages[0]?.from
                        message.messageBody = whatsappMessage.changes[0].value?.messages[0]?.text?.body
                        message.inboundMessageId = whatsappMessage.changes[0].value?.messages[0]?.id
                        message.previousPublishedMessageId = whatsappMessage.changes[0]?.value?.messages[0]?.id 
                    } else {
                        //TODO: Still working to add an SNS Filter Policy to only trigger on messages from users, but the webpayload is also json encoded and SNS Filter Policies don't suport regexes or decoding a JSON payload within the message
                        console.warn('No message found.')
                        callback(null,{})
                        return
                    }
                }
                catch (error) {
                    console.error(error)
                    console.warn('No message found.')
                    callback(null,{})
                    return
                }
            } else {
                message = snsMessage
            }

            if(restartKeywords.includes(message.messageBody.toLowerCase().trim())){
                //restart conversation
                console.debug('restart conversation')
                await DynamoDBService.deleteItemsByPartitionKey(process.env.CONTEXT_DYNAMODB_TABLE, 'phoneNumber', message.originationNumber)
                await sendResponse(channel, message,'Please ask a question.',process.env.KNOWLEDGE_BASE_ID);

            } else {
                //Get Conversation
                let conversation = await getConversation(message.originationNumber, channel)

                //Set Session Id if we have one.
                let sessionId = false
                if (conversation[conversation.length - 1]?.sessionId) sessionId = conversation[conversation.length - 1].sessionId

                //Call to KB
                let retrieveResponse = await BedrockService.retrieveAndGenerate(message.messageBody, process.env.KNOWLEDGE_BASE_ID, sessionId)

                let response = `I'm sorry, I couldn't find an answer based on the information available to me.`
                let source = 'Bedrock Knowledge Base'
                if(retrieveResponse.citations[0]?.retrievedReferences.length){ //We have at least one citation
                    response = retrieveResponse.output.text
                } else { //Couldn't find and answer in KB, so send conversation to general LLM. Comment out this bit to use only KB responses.
                    let formattedConversation = formatConversation(conversation)

                    //Add most recent question to conversation:
                    formattedConversation.push({"role": "user", "content": message.messageBody})

                     //Call to general model
                    const promptEnvelope = {
                        "messages":formattedConversation,
                        "anthropic_version":"bedrock-2023-05-31",
                        "max_tokens": parseInt(process.env.LLM_MAX_TOKENS), 
                        "temperature": parseFloat(process.env.LLM_TEMPERATURE)
                    }

                    source = "General LLM"
                    let parsedResponse = await BedrockService.invokeModel(promptEnvelope);
                    response = parsedResponse.content[0].text
                } 

                if (!sessionId) sessionId = retrieveResponse.sessionId //making sure we carry over sessionID across different LLMs
                await sendResponse(channel, message, response, process.env.KNOWLEDGE_BASE_ID, source, sessionId)

                callback(null,{})
            }
        }
    }
    catch (error) {
        console.error(error);
        callback(null,{}) //TODO: Returning success to prevent needless messages when SNS retries...remove before production
        //callback(error)
    }
}
