/* Copyright 2017 Streampunk Media Ltd.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

var redioactive = require('node-red-contrib-dynamorse-core').Redioactive;
var util = require('util');
var styphoon;
try { styphoon = require('styphoon'); } catch(err) { console.log('SDI-typhoon-In: ' + err); }

var Grain = require('node-red-contrib-dynamorse-core').Grain;

function fixBMDCodes(code) {
  if (code === 'ARGB') return 32;
  return styphoon.bmCodeToInt(code);
}

//const fs = require('fs');
//function TEST_write_buffer(buffer) {
//    output = fs.appendFile('c:\\users\\zztop\\music\\testout.dat', buffer, 'binary');
//}

module.exports = function (RED) {
  function SDIIn (config) {
    RED.nodes.createNode(this,config);
    redioactive.Funnel.call(this, config);

    if (!this.context().global.get('updated'))
      return this.log('Waiting for global context updated.');

    var capture = new styphoon.Capture(
        parseInt(config.deviceIndex),
        parseInt(config.channelIndex),
        fixBMDCodes(config.format),
        config.source,
        config.compressed == 1 ? true : false);
        
    if (config.audio == true)
      capture.enableAudio(styphoon.bmdAudioSampleRate48kHz, styphoon.bmdAudioSampleType24bitInteger, 2);

    var inputStreamMode = capture.getDisplayMode();

    this.log('Typhoon input receiving content of format: ' + inputStreamMode);

    if(inputStreamMode != config.mode)
    {
        this.warn('Typhoon input mode ' + styphoon.intToBMCode(inputStreamMode) + ' conflicts with configured value of ' + config.mode);
    }

    var node = this;
    var frameCount = 0;
    var grainDuration = styphoon.modeGrainDuration(inputStreamMode);
    var encodingName = config.compressed == 1 ? 'H264' : 'raw';

    this.vtags = {
      format : 'video',
      encodingName : encodingName,
      width : styphoon.modeWidth(inputStreamMode),
      height : styphoon.modeHeight(inputStreamMode),
      depth : styphoon.formatDepth(fixBMDCodes(config.format)),
      packing : styphoon.formatFourCC(fixBMDCodes(config.format)),
      sampling : styphoon.formatSampling(fixBMDCodes(config.format)),
      clockRate : 90000,
      interlace : styphoon.modeInterlace(inputStreamMode),
      colorimetry : styphoon.formatColorimetry(fixBMDCodes(config.format)),
      grainDuration : grainDuration
    };

    console.log("Typhoon input vtags = " + JSON.stringify(this.vtags))

    this.atags = {
      format: 'audio',
      encodingName: 'L24',
      clockRate: 48000,
      channels: 2,
      blockAlign: 6,
      grainDuration: grainDuration
    };
    
    this.baseTime = [ Date.now() / 1000|0, (Date.now() % 1000) * 1000000 ];
    var cable = { video: [ { tags: this.vtags } ], backPressure: "video[0]" };
    if (config.audio === true)
      cable.audio = [ { tags: this.atags } ];
    this.makeCable(cable);

    var ids = {
      vFlowID: this.flowID('video[0]'),
      vSourceID: this.sourceID('video[0]'),
      aFlowID: (config.audio === true) ? this.flowID('audio[0]') : undefined,
      aSourceID: (config.audio === true) ? this.sourceID('audio[0]') : undefined
    };

    console.log(`You wanted audio?`, ids);

    this.eventMuncher(capture, 'frame', (video, audio) => {

      console.log('Received event: ', video.length, audio.length);

      //TEST_write_buffer(audio);
      var grainTime = Buffer.allocUnsafe(10);
      grainTime.writeUIntBE(this.baseTime[0], 0, 6);
      grainTime.writeUInt32BE(this.baseTime[1], 6);
      this.baseTime[1] = ( this.baseTime[1] +
        grainDuration[0] * 1000000000 / grainDuration[1]|0 );
      this.baseTime = [ this.baseTime[0] + this.baseTime[1] / 1000000000|0,
        this.baseTime[1] % 1000000000];
      var va = [ new Grain([video], grainTime, grainTime, null,
        ids.vFlowID, ids.vSourceID, grainDuration) ]; // TODO Timecode support
      if (config.audio === true && audio) va.push(
        new Grain([audio], grainTime, grainTime, null,
          ids.aFlowID, ids.aSourceID, grainDuration));
      
      return va;
    });

    capture.on('error', e => {
      this.push(e);
    });

    this.on('close', () => {
      this.close();
      capture.stop();
    });

    capture.start();
  }
  util.inherits(SDIIn, redioactive.Funnel);
  RED.nodes.registerType("sdi-typhoon-in", SDIIn);
}
