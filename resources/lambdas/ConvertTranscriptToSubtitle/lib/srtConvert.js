'use strict'

const Helpers = require('./helpers')
const helpers = new Helpers();
var readline = require('readline');
var rl = readline.createInterface(process.stdin, process.stdout);

module.exports =
    class SrtConvert {
        constructor() {
        }

        convertFile(file) {
            let convertedOutput = '';
            let subtitleIndex = 1;

            const json = JSON.parse(file);

            let current_start = json.results.items[0].start_time;
            let formatted_start;
            let formatted_end;
            let nextline = '';
            let reset = false;

            for (let index = 0; index < json.results.items.length; index++) {
                if (json.results.items[index].type == 'punctuation') {
                    nextline = nextline.slice(0, -1); //Remove the space before punctuation
                    nextline += json.results.items[index].alternatives[0].content;
                    formatted_start = helpers.secondsToMinutes(current_start);
                    formatted_end = helpers.secondsToMinutes(json.results.items[index - 1].end_time);
                    convertedOutput += `${subtitleIndex++}\n`
                    convertedOutput += formatted_start + ' --> ' + formatted_end + '\n';
                    convertedOutput += nextline + '\n\n';
                    nextline = '';
                    let nextItem = json.results.items[index + 1];
                    if (nextItem) {
                        current_start = json.results.items[index + 1].start_time;
                    }
                } else if (json.results.items[index].end_time - current_start > 5) {
                    formatted_start = helpers.secondsToMinutes(current_start);
                    formatted_end = helpers.secondsToMinutes(json.results.items[index - 1].end_time);
                    convertedOutput += `${subtitleIndex++}\n`
                    convertedOutput += formatted_start + ' --> ' + formatted_end + '\n';
                    convertedOutput += nextline + '\n\n';
                    nextline = json.results.items[index].alternatives[0].content + ' ';
                    current_start = json.results.items[index].start_time;
                    ;
                } else {
                    nextline += json.results.items[index].alternatives[0].content + ' ';
                }

            }

            formatted_start = helpers.secondsToMinutes(current_start);
            if (json.results.items[json.results.items.length - 1].type != 'punctuation') {
                formatted_end = helpers.secondsToMinutes(json.results.items[json.results.items.length - 1].end_time);
            } else {
                formatted_end = helpers.secondsToMinutes(json.results.items[json.results.items.length - 2].end_time);
            }

            if (nextline) {
                convertedOutput += `${subtitleIndex++}\n`
                convertedOutput += formatted_start + ' --> ' + formatted_end + '\n';
                convertedOutput += nextline; //Add any leftover words to the end
            }

            return convertedOutput;
        }

    }
