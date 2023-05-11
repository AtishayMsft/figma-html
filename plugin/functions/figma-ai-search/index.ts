// import readline from "readline";
// import fs from "fs";
// import { createEmbeddings, listEmbeddings } from "./create-embeddings";

import { getMatchingResults } from "./search";
import promptMapWithEmbeddings from "./data/PromptMapWithEmbeddings.json";

// Cretae embeddings once and then comment out
// createEmbeddings("./data/PromptMap.json");
// listEmbeddings("./data/PromptMapWithEmbeddings.json") // for testing

// const userInterface = readline.createInterface({
//   input: process.stdin,
//   output: process.stdout,
// });

// userInterface.prompt();

// function readDataFromJSON(fileName) {
//   const data = fs.readFileSync(fileName, "utf8");
//   return JSON.parse(data);
// }

// userInterface.on("line", async (input) => {
//   const promptMapWithEmbeddings = readDataFromJSON(
//     "./data/PromptMapWithEmbeddings.json"
//   );
//   getMatchingResults(input, promptMapWithEmbeddings);
// });

async function getMatchingFigma(inputPrompt: string) {
  const result = await getMatchingResults(inputPrompt, promptMapWithEmbeddings);
  return result;
}

// export { createEmbeddings, listEmbeddings}
export { getMatchingFigma };

export type FigmaEmbedding = {
  id: string;
  prompt: string;
  promptEmbedding: number[];
};

export type PromptMapWithEmbeddings = {
  value: FigmaEmbedding[];
};
