/* global AudioWorkletProcessor, registerProcessor */

const FRAME_SIZE = 4096;
const HOP_SIZE = 1024;

class PitchFrameProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(FRAME_SIZE);
    this.writeIndex = 0;
    this.samplesSinceFrame = 0;
    this.totalSamples = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) {
      return true;
    }
    for (const sample of channel) {
      this.buffer[this.writeIndex] = sample;
      this.writeIndex = (this.writeIndex + 1) % FRAME_SIZE;
      this.samplesSinceFrame += 1;
      this.totalSamples += 1;
      if (this.totalSamples < FRAME_SIZE || this.samplesSinceFrame < HOP_SIZE) {
        continue;
      }
      this.samplesSinceFrame = 0;
      const frame = new Float32Array(FRAME_SIZE);
      for (let index = 0; index < FRAME_SIZE; index += 1) {
        frame[index] = this.buffer[(this.writeIndex + index) % FRAME_SIZE];
      }
      this.port.postMessage(
        {
          samples: frame.buffer,
          audioTimeMs: (this.totalSamples / sampleRate) * 1000,
        },
        [frame.buffer],
      );
    }
    return true;
  }
}

registerProcessor("pitch-frame-processor", PitchFrameProcessor);
