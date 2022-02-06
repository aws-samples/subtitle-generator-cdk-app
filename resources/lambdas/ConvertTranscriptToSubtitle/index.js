const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const db = new AWS.DynamoDB.DocumentClient();

const SrtConvert = require('./lib/srtConvert');
const srtConvert = new SrtConvert();

const BUCKET_NAME = process.env.BUCKET_NAME;
const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';
const CF_URL = process.env.CF_URL;

exports.handler = async (event, context) => {
    const {videoId, sourceLanguageCode} = event;
    const getJson = await new Promise((resolve, reject) => {
        const inputParams = {
            Bucket: BUCKET_NAME,
            Key: `video-transcript/${videoId}.json`
        };

        s3.getObject(inputParams, (err, data) => {
            if (err) {
                console.log(err, err.stack);
                reject(err);
            } else {
                resolve(data);
            }
        });
    });

    const transcriptFile = getJson.Body;
    const transcriptJSON = JSON.parse(transcriptFile);
    const transcript = transcriptJSON.results.transcripts[0].transcript;

    const convertedOutput = srtConvert.convertFile(transcriptFile);
    await new Promise((resolve, reject) => {
        const s3Params = {
            Bucket: BUCKET_NAME,
            Body: transcript,
            Key: `video-transcript/${videoId}/${videoId}.txt`,
        };
        s3.putObject(s3Params, (err, data) => {
            if (err) {
                console.log(err, err.stack);
                reject(err);
            } else {
                resolve(data);
            }
        });
    });

    await new Promise((resolve, reject) => {
        const s3Params = {
            Bucket: BUCKET_NAME,
            Body: convertedOutput,
            Key: `video-subtitle/${videoId}/${videoId}.srt`,
        };
        s3.putObject(s3Params, (err, data) => {
            if (err) {
                console.log(err, err.stack);
                reject(err);
            } else {
                resolve(data);
            }
        });
    });

    const vtt = srt2vtt(convertedOutput);

    await new Promise((resolve, reject) => {
        const s3Params = {
            Bucket: BUCKET_NAME,
            Body: vtt,
            Key: `video-subtitle/${videoId}/${videoId}.vtt`,
        };
        s3.putObject(s3Params, (err, data) => {
            if (err) {
                console.log(err, err.stack);
                reject(err);
            } else {
                resolve(data);
            }
        });
    });

    event.srtKey = `video-subtitle/${videoId}/${videoId}.srt`;

    /** Update DynamoDB Start **/
    const params = {
        TableName: TABLE_NAME,
        Key: {
            [PRIMARY_KEY]: videoId
        }
    };

    const dbItem = (await db.get(params).promise()).Item;
    const index = dbItem.languages.findIndex(language => language.language === sourceLanguageCode.split('-')[0]);
    dbItem.languages[index] = {
        language: sourceLanguageCode.split('-')[0],
        srtURL: `${CF_URL}/video-subtitle/${videoId}/${videoId}.srt`,
        vttURL: `${CF_URL}/video-subtitle/${videoId}/${videoId}.vtt`,
    }

    const updatedDbItem = {
        hasTranscript: true,
        sourceTranscriptURL: `${CF_URL}/video-transcript/${videoId}.txt`,
        languages: [...dbItem.languages],
    }

    const editedItemProperties = Object.keys(updatedDbItem);

    const firstProperty = editedItemProperties.splice(0, 1);
    const updateParams = {
        TableName: TABLE_NAME,
        Key: {
            [PRIMARY_KEY]: videoId
        },
        UpdateExpression: `set ${firstProperty} = :${firstProperty}`,
        ExpressionAttributeValues: {},
        ReturnValues: 'UPDATED_NEW'
    }
    updateParams.ExpressionAttributeValues[`:${firstProperty}`] = updatedDbItem[`${firstProperty}`];

    editedItemProperties.forEach(property => {
        updateParams.UpdateExpression += `, ${property} = :${property}`;
        updateParams.ExpressionAttributeValues[`:${property}`] = updatedDbItem[property];
    });

    await db.update(updateParams).promise();
    /** Update DynamoDB End **/

    return event;
};


function srt2vtt(srt) {
    var vtt = ''
    srt = srt.replace(/\r+/g, '');
    var list = srt.split('\n');
    for (var i = 0; i < list.length; i++) {
        var m = list[i].match(/(\d+):(\d+):(\d+)(?:,(\d+))?\s*--?>\s*(\d+):(\d+):(\d+)(?:,(\d+))?/)
        if (m) {
            vtt += m[1] + ':' + m[2] + ':' + m[3] + '.' + m[4] + ' --> ' + m[5] + ':' + m[6] + ':' + m[7] + '.' + m[8] + '\n';
        } else {
            vtt += list[i] + '\n'
        }
    }
    vtt = "WEBVTT\n\n\n" + vtt
    vtt = vtt.replace(/^\s+|\s+$/g, '');
    return vtt
}
