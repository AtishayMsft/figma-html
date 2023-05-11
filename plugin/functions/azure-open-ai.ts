import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";


const simpleOpenAIRequest = async (prompt: string, lastResponse: string) => {
  // create a new configuration object with the base path set to the Azure OpenAI endpoint
  const configuration = new Configuration({
    basePath: "https://hackathonmay.openai.azure.com/openai/deployments/gpt35turbo", //https://YOUR_AZURE_OPENAI_NAME.openai.azure.com/openai/deployments/YOUR_AZURE_OPENAI_DEPLOYMENT_NAME
  });

  const openai = new OpenAIApi(configuration);

  let conversation: Array<ChatCompletionRequestMessage> = [{
    role: "system",
    content: "Follow these instructions while computing and returning the results. Generate a html output for the asked query. Keep the html and css in the same code block. Return only the html code block as output. Do not return any comments or explanation outside the code block. Use native html5 controls and the latest microsoft fluent ui react styles in the results.",
  }]

  if (lastResponse !== "") {
    conversation.push({role: "assistant", content: lastResponse})
    conversation.push({role: "system", content: "Provide the full code after modification"})
  }

  conversation.push({role: "user", content: prompt})

  const completion = await openai.createChatCompletion(
    {
      model: "gpt-35-turbo", // gpt-35-turbo is the model name which is set as part of the deployment on Azure Open AI
      temperature: 1, // set the temperature to 1 to avoid the AI from repeating itself
      messages: conversation,
      stream: false, // set stream to false to get the full response. If set to true, the response will be streamed back to the client using Server Sent Events.
      // This demo does not use Server Sent Events, so we set stream to false.
    },
    {
      headers: {
        "api-key": "", // set the api-key header to the Azure Open AI key
      },
      params: {
        "api-version": "2023-03-15-preview", // set the api-version to the latest version
      },
    }
  );

  return completion.data.choices[0].message?.content; // return the response from the AI, make sure to handle error cases
};

export async function CallOpenAI(prompt: string, lastResponse: string) {
  // read the request body as JSON

  const response = await simpleOpenAIRequest(prompt, lastResponse);
  return new Response(response);
}
