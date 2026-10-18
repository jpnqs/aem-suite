declare const Files: {
  /** Lets the browser save text as a JSON file. */
  download(filename: string, text: string): void;
  /** Opens the file chooser; resolves with { name, text } or null if nothing was chosen. */
  pickJsonFile(): Promise<{ name: string; text: string } | null>;
};
export default Files;
