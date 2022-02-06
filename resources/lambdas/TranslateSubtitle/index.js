const AWS = require("aws-sdk");
const translate = new AWS.Translate({apiVersion: "2017-07-01"});
const s3 = new AWS.S3({apiVersion: "2006-03-01"});
const db = new AWS.DynamoDB.DocumentClient();

const BUCKET_NAME = process.env.BUCKET_NAME;
const TABLE_NAME = process.env.TABLE_NAME || '';
const PRIMARY_KEY = process.env.PRIMARY_KEY || '';
const CF_URL = process.env.CF_URL;

exports.handler = async (event, context) => {
    const {videoId, targetLanguage} = event;
    const getSrt = await new Promise((resolve, reject) => {
        const inputParams = {
            Bucket: BUCKET_NAME,
            Key: `video-subtitle/${videoId}/${videoId}.srt`
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
    const srtArray = [];
    const firstSplitSrt = getSrt.Body.toString().split('\n\n');
    for (const content of firstSplitSrt) {
        const secondSplitSrt = content.split('\n');
        srtArray.push({
            id: secondSplitSrt[0],
            timecode: secondSplitSrt[1],
            text: secondSplitSrt[2]
        });
    }
    const translatedSrtArray = [];
    for (const srtContent of srtArray) {
        if (srtContent.text) {
            const translatedText = await new Promise((resolve, reject) => {
                const translateParams = {
                    SourceLanguageCode: "auto",
                    Text: srtContent.text,
                    TargetLanguageCode: targetLanguage,
                };
                translate.translateText(translateParams, (err, data) => {
                    if (err) {
                        reject(err);
                    } else {
                        //console.log("Translate Processing Success !!");
                        resolve(data);
                    }
                });
            });/**/
            translatedSrtArray.push(`${srtContent.id}\n${srtContent.timecode}\n${translatedText.TranslatedText}`);
        } else {
            translatedSrtArray.push(`${srtContent.id}\n${srtContent.timecode}\n${srtContent.text}`);
        }
    }
    const resultSrt = translatedSrtArray.join('\n\n');

    await new Promise((resolve, reject) => {
        const s3Params = {
            Bucket: BUCKET_NAME,
            Body: resultSrt,
            Key: `video-subtitle/${videoId}/${videoId}_${targetLanguage}.srt`,
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

    const vtt = srt2vtt(resultSrt);

    await new Promise((resolve, reject) => {
        const s3Params = {
            Bucket: BUCKET_NAME,
            Body: vtt,
            Key: `video-subtitle/${videoId}/${videoId}_${targetLanguage}.vtt`,
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

    event.translatedSrtKey = `video-subtitle/${videoId}/${videoId}_${targetLanguage}.srt`;

    /** Update DynamoDB Start **/
    const params = {
        TableName: TABLE_NAME,
        Key: {
            [PRIMARY_KEY]: videoId
        }
    };

    const dbItem = (await db.get(params).promise()).Item;
    const dbItemLanguagesIndex = dbItem.languages.findIndex(language => language.language === targetLanguage);
    dbItem.languages[dbItemLanguagesIndex] = {
        language: targetLanguage,
        srtURL: `${CF_URL}/video-subtitle/${videoId}/${videoId}_${targetLanguage}.srt`,
        vttURL: `${CF_URL}/video-subtitle/${videoId}/${videoId}_${targetLanguage}.vtt`,
    };

    const updateParams = {
        TableName: TABLE_NAME,
        Key: {
            [PRIMARY_KEY]: videoId
        },
        UpdateExpression: `set languages = :languages`,
        ExpressionAttributeValues: {
            ':languages': dbItem.languages
        },
        ReturnValues: 'UPDATED_NEW'
    }

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
