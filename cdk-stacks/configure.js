// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const configParams = require('./config.params.json')
const { SSMClient, PutParameterCommand, GetParametersCommand, DeleteParametersCommand } = require('@aws-sdk/client-ssm')
const ssmClient = new SSMClient()
const fs = require('fs')
const readline = require("readline")

const SSM_NOT_DEFINED = 'not-defined'
let VERBOSE = false


function displayHelp() {
    console.log(`\nThis script gets deployment parameters and stores the parameters to AWS System Manager Parameter Store \n`)

    console.log(`Usage:\n`)
    console.log(`-i \t Run in interactive mode`)
    console.log(`-l \t When running in interactive mode, load the current parameters from AWS System Manager Parameter Store`)
    console.log(`-t \t Run Test mode (only creates config.cache.json, but it does not store parameters to AWS System Manager Parameter Store)`)
    console.log(`-d \t Delete all AWS SSM Parameters (after CDK stack was destroyed)`)
    displayParametersHelp()
    process.exit(0)
}

function displayParametersHelp() {
    console.log(`\nParameters: \n`)
    configParams.parameters.forEach(param => {
        console.log(`--${param.cliFormat} [${param.required ? 'required' : 'optional'}${param.parent ? ' when ' + getParentObject(param).cliFormat : ''}] \n\t\t${wrapText(param.description, 80)}\n`)
    })
}

function wrapText(s, w) {
    return s.replace(new RegExp(`(?![^\\n]{1,${w}}$)([^\\n]{1,${w}})\\s`, 'g'), '$1\n\t\t')
}

function getParentObject(param) {
    return configParams.parameters.find(parent => parent.name === param.parent)
}

function isParentEnabled(param) {
    return configParams.parameters.find(parent => parent.name === param.parent).value === true
}

function isNotDefined(param) {
    return param.value === SSM_NOT_DEFINED
}

function isUndefinedNullEmpty(value) {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

function throwParameterRequired(param) {

    throw new Error(`Required parameter not provided: [${param.cliFormat}]`)
}

async function loadParametersSSM() {
    console.log(`\nLoading current parameters from AWS System Manager Parameter Store\n`);

    const chunkedParameters = chunkArray(configParams.parameters, 10);
    for (let i = 0; i < chunkedParameters.length; i++) {
        const getParametersResult = await getParametersSSMBatch(chunkedParameters[i]).catch(error => {
            console.log(`ERROR: getParametersSSMBatch: ${error.message}`); return undefined;
        });

        getParametersResult?.forEach(loadedParam => {
            if (loadedParam.Value && loadedParam.Name) {
                const configParam = configParams.parameters.find(configParam => configParam.name === /[^/]*$/.exec(loadedParam.Name)[0]);
                configParam.value = parseParam(loadedParam.Value);
            }
        });

        if (i !== 0 && i % 2 === 0) await wait(1000);
    }

    console.log(`\nLoad completed\n`);
}

async function getParametersSSMBatch(parametersArray) {
    if (parametersArray?.length < 1 || parametersArray?.length > 10) throw new Error(`getParametersSSMBatch -> parametersArray -> Minimum number of 1 item. Maximum number of 10 items`);

    const paramNamesArray = parametersArray.map((param) => `${configParams.hierarchy}${param.name}`);

    const getParametersResult = await ssmClient.send(new GetParametersCommand({ Names: paramNamesArray }));

    getParametersResult?.InvalidParameters?.forEach(invalidParam => { console.log(`Error loading parameter: ${invalidParam}`); });

    return getParametersResult?.Parameters;
}

async function storeParametersSSM() {
    console.log(`\nStoring parameters to AWS System Manager Parameter Store\n`)

    const chunkedParameters = chunkArray(configParams.parameters, 5);
    for (let i = 0; i < chunkedParameters.length; i++) {
        await putParametersSSMBatch(chunkedParameters[i]).catch(error => {
            console.log(`ERROR: putParametersSSMBatch: ${error.message}`);
        });
        await wait(1000);
    }

    console.log(`\nStore completed\n`)
}

async function putParametersSSMBatch(parametersArray) {
    if (parametersArray?.length < 1 || parametersArray?.length > 5) throw new Error(`putParametersSSMBatch -> parametersArray -> Minimum number of 1 item. Maximum number of 5 items`);

    for (const param of parametersArray) {
        console.log(`\nAWS SSM put ${configParams.hierarchy}${param.name} = ${param.value}`);
        //supports only String parameters
        const putParameterResult = await ssmClient.send(new PutParameterCommand({ Type: 'String', Name: `${configParams.hierarchy}${param.name}`, Value: param.boolean ? param.value.toString() : param.value, Overwrite: true }));
        console.log(`Stored param: ${configParams.hierarchy}${param.name} | tier: ${putParameterResult.Tier} | version: ${putParameterResult.Version}\n`);
    }
}

async function deleteParametersSSM() {
    console.log(`\nDeleting parameters to AWS System Manager Parameter Store\n`);

    const chunkedParameters = chunkArray(configParams.parameters, 10);
    for (let i = 0; i < chunkedParameters.length; i++) {
        await deleteParametersSSMBatch(chunkedParameters[i]).catch(error => {
            console.log(`ERROR: deleteParametersSSMBatch: ${error.message}`);
        });
        await wait(1000);
    }

    console.log(`\nDelete completed\n`)
    process.exit(0);
}

async function deleteParametersSSMBatch(parametersArray) {
    if (parametersArray?.length < 1 || parametersArray?.length > 10) throw new Error(`deleteParametersSSMBatch -> parametersArray -> Minimum number of 1 item. Maximum number of 10 items`);

    const paramNamesArray = parametersArray.map((param) => `${configParams.hierarchy}${param.name}`);
    const deleteParametersResult = await ssmClient.send(new DeleteParametersCommand({ Names: paramNamesArray }));

    deleteParametersResult?.InvalidParameters?.forEach(invalidParam => { console.log(`Error deleting parameter: ${invalidParam}`); });

    deleteParametersResult?.DeletedParameters?.forEach(deletedParam => { console.log(`Deleted param: ${deletedParam}`) });
}

function chunkArray(inputArray, chunkSize) {
    let index = 0;
    const arrayLength = inputArray.length;
    let resultArray = [];

    for (index = 0; index < arrayLength; index += chunkSize) {
        let chunkItem = inputArray.slice(index, index + chunkSize);
        resultArray.push(chunkItem);
    }

    return resultArray;
}

function wait(time) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), time);
    });
}

async function writeConfigCacheJSON() {
    console.log(`\nWriting current parameters to config.cache.json\n`)

    const configCache = {}
    for (const param of configParams.parameters) {
        configCache[`${configParams.hierarchy}${param.name}`] = param.value
    }

    fs.writeFileSync('config.cache.json', JSON.stringify(configCache, null, '\t'))

    console.log(`\nWrite completed\n`)
}

function checkRequiredParameters() {

    for (const param of configParams.parameters) {
        if (param.required && !param.parent && isNotDefined(param)) {
            throwParameterRequired(param)
        }

        if (param.required && param.parent && isParentEnabled(param) && isNotDefined(param)) {
            throwParameterRequired(param)
        }
    }
}

function initParameters() {
    for (const param of configParams.parameters) {
        param.value = isUndefinedNullEmpty(param.defaultValue) ? SSM_NOT_DEFINED : param.defaultValue
    }
}

function displayInputParameters() {
    console.log(`\nInput parameters:\n`)

    for (const param of configParams.parameters) {
        console.log(`${param.cliFormat} = ${param.value}`)
    }
}

function parseParam(value) {
    let tValue = value.trim()
    if (typeof tValue === 'string' && tValue.toLocaleLowerCase() === 'true') return true
    if (typeof tValue === 'string' && tValue.toLowerCase() === 'false') return false
    return tValue
}

function getArgs() {
    const argFlags = {}
    const argParams = {}

    process.argv
        .slice(2, process.argv.length)
        .forEach(arg => {
            // long args
            if (arg.slice(0, 2) === '--') {
                const longArg = arg.split('=');
                const longArgFlag = longArg[0].slice(2, longArg[0].length);
                const longArgValue = longArg.length > 1 ? parseParam(longArg[1]) : true;
                argParams[longArgFlag] = longArgValue;
            }
            // flags
            else if (arg[0] === '-') {
                const flags = arg.slice(1, arg.length).split('');
                flags.forEach(flag => {
                    argFlags[flag] = true;
                });
            }
        });
    return { argFlags: argFlags, argParams: argParams };
}

async function runInteractive(loadSSM = false) {
    if (loadSSM) {
        await loadParametersSSM()
    }
    await promptForParameters()
}

function buildQuestion(question, rl) {
    return new Promise((res, rej) => {
        rl.question(question, input => {
            res(input);
        })
    });
}

async function promptForParameters() {
    console.log(`\nPlease provide your parameters:\n`)

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    for (const param of configParams.parameters) {
        if (!param.parent || (param.parent && isParentEnabled(param))) {
            const input = await buildQuestion(`${param.cliFormat} [${param.value}]`, rl)
            if (input.trim() !== '') {
                param.value = parseParam(input)
            }
        }
    }

    rl.close()
}

function processArgParams(argParams) {

    for (const param of configParams.parameters) {
        const argValue = argParams[param.cliFormat]
        if (argValue !== undefined) {
            param.value = argValue
        }
    }
}

async function run() {
    try {
        const { argFlags, argParams } = getArgs();

        if (argFlags['v'] === true) {
            VERBOSE = true
        }

        if (argFlags['h'] === true) {
            return displayHelp()
        }

        if (argFlags['d'] === true) {
            return await deleteParametersSSM()
        }

        if (argFlags['t'] === true) {
            console.log(`\nRunning in test mode\n`)
        }

        initParameters()

        if (argFlags['i'] === true) {
            console.log(`\nRunning in interactive mode\n`)
            await runInteractive(argFlags['l'])
        }
        else {
            processArgParams(argParams)
        }

        displayInputParameters()

        checkRequiredParameters()

        writeConfigCacheJSON()

        if (argFlags['t'] !== true) {
            await storeParametersSSM()
        }

        console.log(`\nConfiguration complete, review your parameters in config.cache.json\n`)
        process.exit(0)
    }
    catch (error) {
        console.error(`\nError: ${error.message}\n`)
        if (VERBOSE) console.log(error)
        process.exit(1)
    }

}

run()



