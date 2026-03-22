export const extractAudioFromVideo = async (videoFile: File): Promise<File> => {
    if (videoFile.type.startsWith('audio/')) return videoFile;

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 8000 // Even lower sample rate to ensure files stay under Whisper 25MB limit
    });

    const arrayBuffer = await videoFile.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // FORÇAR MONO: Reduz o tamanho do arquivo pela metade sem perda de qualidade para a IA.
    const numOfChan = 1; 
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

    // Mixdown para Mono (apenas o primeiro canal ou média dos dois)
    channels.push(audioBuffer.getChannelData(0));

    pos = 44;
    while (pos < length) {
        // Pega o sample do canal 0 (mono)
        sample = Math.max(-1, Math.min(1, channels[0][offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        view.setInt16(pos, sample, true);
        pos += 2;
        offset++;
    }

    return new File([buffer], videoFile.name.replace(/\.[^/.]+$/, "") + ".wav", { type: 'audio/wav' });
};
