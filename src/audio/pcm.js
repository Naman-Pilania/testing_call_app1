export function resamplePcm16(input, inputRate, outputRate) {
  if (inputRate === outputRate) {
    return input;
  }

  if (input.length % 2 !== 0 || inputRate <= 0 || outputRate <= 0) {
    throw new Error("Invalid PCM audio buffer or sample rate");
  }

  const inputSamples = input.length / 2;

  if (inputSamples === 0) {
    return Buffer.alloc(0);
  }

  const outputSamples = Math.max(
    1,
    Math.round((inputSamples * outputRate) / inputRate),
  );

  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const sourcePosition = (i * inputRate) / outputRate;
    const left = Math.min(Math.floor(sourcePosition), inputSamples - 1);
    const right = Math.min(left + 1, inputSamples - 1);
    const fraction = sourcePosition - left;

    const a = input.readInt16LE(left * 2);
    const b = input.readInt16LE(right * 2);

    const sample = Math.round(a + (b - a) * fraction);
    const clamped = Math.max(-32768, Math.min(32767, sample));

    output.writeInt16LE(clamped, i * 2);
  }

  return output;
}
