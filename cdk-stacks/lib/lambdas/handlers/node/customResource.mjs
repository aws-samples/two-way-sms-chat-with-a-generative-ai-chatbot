import { configure, sendSuccess, sendFailure, sendResponse, LOG_VERBOSE, SUCCESS } from 'cfn-custom-resource';
import { PinpointSMSVoiceV2Client, UpdatePhoneNumberCommand } from "@aws-sdk/client-pinpoint-sms-voice-v2"; // ES Modules import
import { BedrockAgentClient, CreateDataSourceCommand, StartIngestionJobCommand } from "@aws-sdk/client-bedrock-agent"; // ES Modules import
const bedrockClient = new BedrockAgentClient({});

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const dynamoDBClient = new DynamoDBClient({ region: process.env.AWS_REGION });
const ddbDocClient = DynamoDBDocument.from(dynamoDBClient);

import crypto from 'crypto';
const pinpointClient = new PinpointSMSVoiceV2Client({});

/****************
 * Helper Functions
****************/
const createWebDataSource = async (knowledgeBaseId, url) => {
  try {
    const input = { 
      knowledgeBaseId: knowledgeBaseId, 
      name: "web-datasource-createby-eum-demo", 
      description: "Example Web Crawler Created By EUM Demo Solution",
      dataSourceConfiguration: { 
        type: "WEB",
        webConfiguration: { 
          sourceConfiguration: { 
            urlConfiguration: { 
              seedUrls: [ 
                { 
                  url: url,
                },
              ],
            },
          },
          crawlerConfiguration: { 
            crawlerLimits: { // Setting reasonable limit, adjust as needed
              rateLimit: 30,
            },
          },
        },
      },
      dataDeletionPolicy: "DELETE",
    };
    console.trace(input)
    const command = new CreateDataSourceCommand(input);
    const response = await bedrockClient.send(command);
    console.trace(response)
    return response.dataSource.dataSourceId
  }
  catch (error) {
      console.error(error);
      return false
  }
}

const startIngestionJob = async (knowledgeBaseId, dataSourceId) => {
  try {
    const params = { 
      knowledgeBaseId: knowledgeBaseId, 
      dataSourceId: dataSourceId
    };
    console.trace(params)
    const ingestionCommand = new StartIngestionJobCommand(params);
    const ingestionResponse = await bedrockClient.send(ingestionCommand);
    console.trace(ingestionResponse)
    return ingestionResponse
  }
  catch (error) {
      console.error(error);
      return false
  }
}

const updatePhoneNumber = async (props) => {
  try {
    const input = { 
      PhoneNumberId: props.OriginationNumberId, 
      TwoWayEnabled: true,
      TwoWayChannelArn: props.ChatSNSTopicARN,
      TwoWayChannelRole: props.SNSRoleARN,
      SelfManagedOptOutsEnabled: false,
      DeletionProtectionEnabled: false,
    };
    console.trace(input)
    const command = new UpdatePhoneNumberCommand(input);
    const response = await pinpointClient.send(command);
    console.trace(response);
    return response
  }
  catch (error) {
      console.error(error);
      return false
  }
}

const putDynamoDBItem = async (tableName, item) => {
  const params = {
    TableName : tableName,
    Item: item
  }

  try {
    const results = await ddbDocClient.put(params);
    return results
  } catch (error) {
    console.error(error);
    return false
  }
}

/****************
 * Main
****************/
export const handler = async (event, context, callback) => {
    console.log('Received event:', JSON.stringify(event, null, 2));

    const props = event.ResourceProperties
    const requestType = event.RequestType
    let physicalId = event.PhysicalResourceId

    if (requestType === 'Create') {
        physicalId = `vce.eum-config.${crypto.randomUUID()}`
    } else if(!physicalId) {
        sendResponse(event, context.logStreamName, 'FAILED', `invalid request: request type is '${requestType}' but 'PhysicalResourceId' is not defined`)
    }

    try{
      switch (event.ResourceType){
        case 'Custom::EUMConfig':
          if (requestType === 'Create' || requestType === 'Update'){
            //Create or Update Stuff
            await updatePhoneNumber(props);
            const result = await sendSuccess(physicalId, { }, event);
            return result
          } else if(requestType === 'Delete'){
            //Delete Stuff
            const result = await sendSuccess(physicalId, { }, event);
            return result
          } else {
            const result = await sendSuccess(physicalId, { }, event);
            return result
          }

        case 'Custom::CreateWebDatasource':
          if (requestType === 'Create' || requestType === 'Update'){
            let dataSourceId = await createWebDataSource(props.KnowledgeBaseId, props.CrawlURL);
            await startIngestionJob(props.KnowledgeBaseId, dataSourceId);

            const result = await sendSuccess(physicalId, { }, event);
            return result
          } else {
            const result = await sendSuccess(physicalId, { }, event);
            return result
          }

        default:
          const result = await sendSuccess(physicalId, { }, event);
          return result
      }
    }
    catch (ex){
      console.log(ex);
      const result = await sendFailure(physicalId, ex, event);
      return result
    }
};

