declare const Files: {
  /** Lets the browser save text as a file - a JSON file unless another media type is given. */
  download(filename: string, text: string, type?: string): void;
  /** Opens the file chooser; resolves with { name, text } or null if nothing was chosen. */
  pickJsonFile(): Promise<{ name: string; text: string } | null>;
};
export default Files;
