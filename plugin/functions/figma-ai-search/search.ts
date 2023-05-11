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
export async function getMatchingResults(
  inputPrompt: string,
  promptMapWithEmbeddings: PromptMapWithEmbeddings
) {
  const promptEmbedding = await createEmbedding(inputPrompt);

  // create map of text against similarity score
  const similarityScoreHash = getSimilarityScore(
    promptMapWithEmbeddings,
    promptEmbedding
  );
  console.log("similarityScoreHash -", similarityScoreHash);

  // get text (i.e. key) from score map that has highest similarity score
  const figmaId = Object.keys(similarityScoreHash).reduce((a, b) =>
    similarityScoreHash[a] > similarityScoreHash[b] ? a : b
  );
  return figmaId;
}
