// For Node.js
/**
import { Configuration, OpenAIApi } from "openai";
import fs from "fs";
import { apiKey } from "./key"; // key.ts is not included in this repo
// export const apiKey = 'YOUR_KEY' // azure open ai api key

const EMBEDDING_MODEL = "text-embedding-ada-002";
// Set up the OpenAI API client
const configuration = new Configuration({
  apiKey,
});
const openai = new OpenAIApi(configuration);

function readDataFromJSON(fileName) {
  const data = fs.readFileSync(fileName, "utf8");
  return JSON.parse(data);
}

async function createJsonFile(promptMap) {
  const prompts = promptMap.value.map(({ id, prompt, promptEmbedding }) => ({
    id,
    prompt,
    promptEmbedding,
  }));
  const newPromptMap = {
    value: prompts,
  };
  const json = JSON.stringify(newPromptMap);
  fs.writeFile(
    "./data/PromptMapWithEmbeddings.json",
    json,
    "utf8",
    function (err) {
      if (err) console.log("Error in File creation", err);
      else console.log("File created successfully");
    }
  );
}

async function createEmbedding(prompt) {
  const embedding = await openai.createEmbedding({
    model: EMBEDDING_MODEL,
    input: prompt,
  });
  return embedding.data.data[0].embedding;
}

export async function createEmbeddings(fileName) {
  const promptMap = readDataFromJSON(fileName);

  promptMap.value.forEach(async (figmaData, index) => {
    const promptEmbedding = await createEmbedding(figmaData.prompt);
    figmaData.promptEmbedding = promptEmbedding;
    if (index === promptMap.value.length - 1) {
      setTimeout(() => {
        createJsonFile(promptMap);
      }, 5000); // update
    }
  });
}

// init();

// Test function
export function listEmbeddings(fileName) {
  const promptMap = readDataFromJSON(fileName);
  console.log("promptMap -", promptMap);
}
// listEmbeddings();
 */