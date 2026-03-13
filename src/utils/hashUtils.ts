export const generateFileHash = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
};

export const generateFilesHashes = async (files: File[]): Promise<string[]> => {
  return Promise.all(files.map(file => generateFileHash(file)));
};

/**
 * Compara dois arrays de hashes sem se importar com a ordem
 */
export const areHashesEqual = (hashes1: string[], hashes2: string[]): boolean => {
  if (hashes1.length !== hashes2.length) return false;
  const sorted1 = [...hashes1].sort();
  const sorted2 = [...hashes2].sort();
  return sorted1.every((hash, index) => hash === sorted2[index]);
};
