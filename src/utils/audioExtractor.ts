export const extractAudioFromVideo = async (videoFile: File): Promise<File> => {
    if (videoFile.type.startsWith('audio/')) return videoFile;

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000 // Lower sample rate for speech to save space
    });

    const arrayBuffer = await videoFile.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const numOfChan = audioBuffer.numberOfChannels;
    const length = audioBuffer.length * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let sample = 0;
    let offset = 0;
    let pos = 0;

    const setString = (off: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(off + i, string.charCodeAt(i));
        }
    };

    setString(0, 'RIFF');
    view.setUint32(4, length - 8, true);
    setString(8, 'WAVE');
    setString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numOfChan, true);
    view.setUint32(24, audioBuffer.sampleRate, true);
    view.setUint32(28, audioBuffer.sampleRate * 2 * numOfChan, true);
    view.setUint16(32, numOfChan * 2, true);
    view.setUint16(34, 16, true);
    setString(36, 'data');
    view.setUint32(40, length - pos - 4, true);

    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        channels.push(audioBuffer.getChannelData(i));
    }

    pos = 44;
    while (pos < length) {
        for (let i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
            view.setInt16(pos, sample, true);
            pos += 2;
        }
        offset++;
    }

    return new File([buffer], videoFile.name.replace(/\.[^/.]+$/, "") + ".wav", { type: 'audio/wav' });
};
