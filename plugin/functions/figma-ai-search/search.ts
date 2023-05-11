import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { PromptMapWithEmbeddings } from "./index";
import { apiKey } from "./key"; // key.ts is not included in this repo
// export const apiKey = 'YOUR_KEY' // azure open ai api key

const API_URL =
  "https://hackathonmay.openai.azure.com/openai/deployments/text-embedding-ada-002/embeddings?api-version=2022-12-01";

function cosineSimilarity(A: number[], B: number[]) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < A.length; i++) {
    dotProduct += A[i] * B[i];
    normA += A[i] * A[i];
    normB += B[i] * B[i];
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  return dotProduct / (normA * normB);
}

function getSimilarityScore(
  promptMapWithEmbeddings: PromptMapWithEmbeddings,
  promptEmbedding: number[]
) {
  const similarityScoreHash: any = {};
  promptMapWithEmbeddings.value.forEach(
    async ({ id, promptEmbedding: figmaPromptEmbedding }) => {
      similarityScoreHash[id] = cosineSimilarity(
        promptEmbedding,
        figmaPromptEmbedding
      );
    }
  );
  return similarityScoreHash;
}

async function createEmbedding(prompt: string) {
  const headers = new Headers();
  headers.append("api-key", apiKey);
  headers.append("Content-Type", "application/json");

  const body = JSON.stringify({
    input: prompt,
  });

  var requestOptions = {
    method: "POST",
    headers: headers,
    body: body,
  };
  try {
    let response = await fetch(API_URL, requestOptions);
    let promptEmbeddingsResponse = await response.json();
    return promptEmbeddingsResponse.data[0].embedding;
  } catch (err) {
    console.log("Error generated: ", err);
  }
}

async function expandInputPrompt(inputPrompt:string) {
  const prompt = `what are the UI elements needed while creating a design with following command "${inputPrompt}"? Give response in comma separated array and nothing else`;
  const configuration = new Configuration({
    apiKey,
    basePath: "https://hackathonmay.openai.azure.com/openai/deployments/gpt35turbo"
  });

  let conversation: Array<ChatCompletionRequestMessage> = [{
    role: "system",
    content: "User needs to build a design for web, browser, or mobile. Help find the UI elements needed to create a UI page. Give response in comma separated string and nothing else",
   // content: "Follow these instructions while computing and returning the results. Generate a html output for the asked query. Keep the html and css in the same code block. Return only the html code block as output. Do not return any comments or explanation outside the code block. Use native html5 controls and the latest microsoft fluent ui react styles in the results.",
  }]

  conversation.push({role: "user", content: inputPrompt})

  const openai = new OpenAIApi(configuration);
  const options = {
    headers: {
      "api-key": apiKey, // set the api-key header to the Azure Open AI key
    },
    params: {
      "api-version": "2023-03-15-preview", // set the api-version to the latest version
    },
  }
  const completion = await openai.createChatCompletion(
    {
      model: "gpt-35-turbo", // gpt-35-turbo is the model name which is set as part of the deployment on Azure Open AI
      temperature: 1, // set the temperature to 1 to avoid the AI from repeating itself
      // prompt: prompt,
      messages: conversation,
      stream: false,
    },
    options
  );

  console.log('UI elements recommended are: ', completion.data.choices[0].message?.content);
  return `${inputPrompt} ${completion.data.choices[0].message?.content}`
  
}
export async function getMatchingResults(
  inputPrompt: string,
  promptMapWithEmbeddings: PromptMapWithEmbeddings
) {
  // expand input prompt
  const expandedInputPrompt = await expandInputPrompt(inputPrompt);
  const promptEmbedding = await createEmbedding(expandedInputPrompt);

  // create map of text against similarity score
  const similarityScore = getSimilarityScore(
    promptMapWithEmbeddings,
    promptEmbedding
  );
  console.log("similarityScore -", similarityScore);

  // sort similarity score map in descending order
  const sortedSimilarityScore = Object.keys(similarityScore).sort(
    (a, b) => similarityScore[b] - similarityScore[a]
  );

  console.log("sortedSimilarityScore -", sortedSimilarityScore);
 
  // return top 5 results
  return sortedSimilarityScore.slice(0, 3);
}
