import * as React from "react";
import { Textarea } from "./textarea";
import { Button, CircularProgress } from "@material-ui/core";
import { Input } from "./input";
import { ClientStorage, apiHost, getImageFills, processImages } from "../ui";
import { settings } from "../constants/settings";
import { traverseLayers } from "../functions/traverse-layers";
import * as amplitude from "../functions/track";
import { theme } from "../constants/theme";
import { HelpTooltip } from "./help-tooltip";
import { TextLink, TooltipTextLink } from "./text-link";
import { useDev } from "../constants/use-dev";
import { HelpOutline } from "@material-ui/icons";
import { htmlToFigma } from "../../lib/html-to-figma";
import { Configuration, OpenAIApi } from "openai";

const simpleOpenAIRequest = async (prompt: string) => {
  // create a new configuration object with the base path set to the Azure OpenAI endpoint
  const configuration = new Configuration({
    basePath: "https://hackathonmay.openai.azure.com/openai/deployments/gpt35turbo", //https://YOUR_AZURE_OPENAI_NAME.openai.azure.com/openai/deployments/YOUR_AZURE_OPENAI_DEPLOYMENT_NAME
  });

  const openai = new OpenAIApi(configuration);

  const completion = await openai.createChatCompletion(
    {
      model: "gpt-35-turbo", // gpt-35-turbo is the model name which is set as part of the deployment on Azure Open AI
      temperature: 1, // set the temperature to 1 to avoid the AI from repeating itself
      messages: [
        {
          role: "system",
          content: "Follow these instructions while computing and returning the results. Generate a html output for the asked query. Return only the html code block as output. Do not return any comments or explanation. Use native html5 controls and the latest microsoft fluent ui react styles in the results.",
        },
        {
          role: "user",
          content: prompt, // set the prompt to the user's input
        },
      ],
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

export async function CallOpenAI(prompt: string) {
  // read the request body as JSON

  const response = await simpleOpenAIRequest(prompt);
  return new Response(response);
}

export const aiApiHost = useDev
  ? "http://localhost:4000"
  : // Need to use raw function URL to support streaming
    "https://ai-to-figma-tk43uighdq-uc.a.run.app";

const numPreviews = 4;

const tryJsonParse = (str: string) => {
  try {
    return JSON.parse(str);
  } catch (err) {
    return null;
  }
};

function defaultPreviews() {
  return Array.from({ length: numPreviews }, () => "");
}

function countInstancesOf(string: string, char: string) {
  return string.split(char).length;
}

function addImagesToHtml(html: string, index: number, images: string[]) {
  let i = 0;
  return html.replace(/image\.jpg/g, () => {
    const useIndex = index + i++;
    return images[useIndex % 4] || defaultImage;
  });
}

const defaultImage =
  "https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F72c80f114dc149019051b6852a9e3b7a";

function defaultImages() {
  return Array.from({ length: numPreviews }, () => defaultImage);
}

export function AiImport(props: {
  clientStorage: ClientStorage | null;
  updateClientStorage: (clientStorage: ClientStorage) => void;
}) {
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const [previews, setPreviews] = React.useState(defaultPreviews());
  const images = React.useRef<string[]>(defaultImages());
  const [prompt, setPrompt] = React.useState("a settings page");
  const [style, setStyle] = React.useState("everlane.com");
  const [openAiKey, setOpenAiKey] = React.useState(
    props.clientStorage?.openAiKey
  );
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean | string>(false);

  React.useEffect(() => {
    if (props.clientStorage) {
      props.updateClientStorage({ ...props.clientStorage, openAiKey });
    }
  }, [openAiKey]);

  React.useEffect(() => {
    function handler(e: MessageEvent) {
      const { data: rawData, source } = e as MessageEvent;
      const data = rawData.pluginMessage;

      if (data.type === "doneLoading") {
        setLoading(false);
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  function hasPreviews() {
    return previews.filter(Boolean).length > 0;
  }

  React.useEffect(() => {
    if (hasPreviews()) {
      parent.postMessage(
        {
          pluginMessage: {
            type: "resize",
            width: 1025,
            height: settings.ui.baseHeight,
          },
        },
        "*"
      );
    } else {
      parent.postMessage(
        {
          pluginMessage: {
            type: "resize",
            width: settings.ui.baseWidth,
            height: settings.ui.baseHeight,
          },
        },
        "*"
      );
    }

    return () => {
      parent.postMessage(
        {
          pluginMessage: {
            type: "resize",
            width: settings.ui.baseWidth,
            height: settings.ui.baseHeight,
          },
        },
        "*"
      );
    };
  }, [hasPreviews()]);

  async function fetchImages() {
    images.current = defaultImages();
    const response = await fetch(
      `${aiApiHost}/api/v1/ai-to-figma/generate-image`,
      {
        method: "POST",
        signal: abortControllerRef.current?.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: `A lifestyle image like would be on ${style}'s homepage. It should look like a photo taken by a photographer.`,
          key: openAiKey,
          size: "256x256",
          number: numPreviews,
        }),
      }
    );
    const json = await response.json();
    images.current = json.images.map((img: any) => img.url);

    setPreviews((previews) =>
      previews.map((preview, index) =>
        addImagesToHtml(preview, index, images.current)
      )
    );
  }

  function fromString(str: string): HTMLElement {
    const div = document.createElement('div');
    div.innerHTML = str.trim();
    document.body.innerHTML = "";
    document.body.appendChild(div);
    return div as HTMLElement;
  }

  function importHtmlToFigma(htmlContent: string) {
    const htmlContent0 = `<div className="div">
    <div className="div-2">Login</div>
    <div className="div-3">Username</div>
    <div className="div-4" />
    <div className="div-5" />
    <div className="div-6">Password</div>
    <div className="div-7" />
    <div className="div-8" />
    <div className="div-9">Sign in</div>
  </div>`

  const htmlContent1 = `
  <div class="container">
    <div class="header">
      <h1>Settings</h1>
      <button class="ms-Button ms-Button--primary">Save</button>
    </div>
    <div class="body">
      <h2>Personal Information</h2>
      <div class="ms-TextField">
        <label class="ms-Label">Name</label>
        <input class="ms-TextField-field" type="text" />
      </div>
      <div class="ms-TextField">
        <label class="ms-Label">Email</label>
        <input class="ms-TextField-field" type="email" />
      </div>
      <div class="ms-TextField">
        <label class="ms-Label">Phone Number</label>
        <input class="ms-TextField-field" type="tel" />
      </div>
      <h2>Preferences</h2>
      <div class="ms-ChoiceFieldGroup">
        <div class="ms-ChoiceField">
          <input class="ms-ChoiceField-input" type="checkbox" id="notifications" />
          <label class="ms-ChoiceField-label" for="notifications">Receive notifications</label>
        </div>
        <div class="ms-ChoiceField">
          <input class="ms-ChoiceField-input" style="border-color: #92a8d1;" type="checkbox" id="dark-mode" />
          <label class="ms-ChoiceField-label" style="border-color: #92a8d1;" for="dark-mode">Dark mode</label>
        </div>
      </div>
    </div>
  </div>`

    const htmlEle: HTMLElement = fromString(htmlContent);   
    console.log(htmlEle)
    const layers = htmlToFigma(htmlEle);

    const jsonObj = {"layers": layers}

    parent.postMessage(
      {
        pluginMessage: {
          type: "import",
          data: jsonObj,
          blurImages: true,
        },
      },
      "*"
    );
  }

  function importHtmlviabuilderApi(htmlContent: string) {
    fetch(`${apiHost}/api/v1/url-to-figma?width=1200`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        html: htmlContent,
      }),
    })
      .then((res) => {
        if (!res.ok) {
          console.error("Url-to-figma failed", res);
          amplitude.track("import for ai error");
          throw new Error("Url-to-figma failed");
        }
        amplitude.incrementUserProps("import_count");
        amplitude.track("import to figma for ai", {
          type: "url",
        });
        return res.json();
      })
      .then((data) => {
        const layers = data.layers;
        return Promise.all(
          [data].concat(
            layers.map(async (rootLayer: Node) => {
              await traverseLayers(
                rootLayer as any,
                (layer: any) => {
                  if (getImageFills(layer)) {
                    return processImages(layer).catch((err) => {
                      console.warn("Could not process image", err);
                    });
                  }
                }
              );
            })
          )
        );
      })
      .then((data) => {
        parent.postMessage(
          {
            pluginMessage: {
              type: "import",
              data: data[0],
              blurImages: true,
            },
          },
          "*"
        );
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
        alert(err);
      });
  }

  async function onSubmit(e: React.FormEvent | React.KeyboardEvent) {
    e.preventDefault();
    setError(null);
    setLoading("Generating...");

    const useLocalHtmltoFigma = false;

    const gptResponse = await CallOpenAI(prompt)
    const responseText = await gptResponse.text();
    if (useLocalHtmltoFigma) {
      const match = responseText.match(/<body.*>([^`]+)<\/body>/);
      if (match) {
        console.log(match[1]);
        const htmlContent = match[1];
        importHtmlToFigma(htmlContent);
      }
    } else {
        const match = responseText.match(/```([^`]+)```/);
        if (match) {
          console.log(match[1]);
          const htmlContent = match[1];
          importHtmlviabuilderApi(htmlContent);
        }
    }

  /*   if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setPreviews(defaultPreviews());
    fetchImages();

    try {
      const response = await fetch(`${aiApiHost}/api/v1/ai-to-figma/preview`, {
        method: "POST",
        signal: abortControllerRef.current.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          style: style,
          prompt: prompt,
          key: openAiKey,
          number: numPreviews,
        }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder("utf-8");

      const html = ["", "", "", ""];

      let fullResponseText = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        const textArr = decoder.decode(value, { stream: true }).split("\n");

        for (const text of textArr) {
          fullResponseText += text;
          if (text.startsWith("data:")) {
            try {
              const { index, content } = JSON.parse(text.replace("data:", ""));

              html[index] += content;
              const item = html[index];
              // Make sure we don't stream in partial tags like `<div ...` before we close it
              if (countInstancesOf(item, "<") === countInstancesOf(item, ">")) {
                previews[index] = addImagesToHtml(item, index, images.current);

                setPreviews([...previews]);
              }
            } catch (err) {
              console.warn(`Could not parse JSON from chunk: ${text}`);
              // Continue
            }
          }
        }
      }
      const resJson = tryJsonParse(fullResponseText);
      if (resJson && resJson.error) {
        const message = resJson.error.message;
        setError(message);
      } else if (!hasPreviews() && fullResponseText.trim().length) {
        setError(fullResponseText);
      }
    } catch (err) {
      console.error("Error fetching previews: ", err);
      setError(
        `
        We had an issue generating results. Please make sure you have a working internet connection and try again, and if this issue persists please let us know at https://github.com/BuilderIO/figma-html/issues
      `.trim()
      );
    } finally {
      setLoading(false);
    } */
  }

  return (
    <div style={{ display: "flex" }}>
      <div
        style={{
          width: settings.ui.baseWidth,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          padding: "7 20",
        }}
      >
        <form onSubmit={onSubmit}>
          <h4>
            Prompt{" "}
            <HelpTooltip>
              <>Be as detailed and specific as possible.</>
            </HelpTooltip>
          </h4>
          <Textarea
            onKeyPress={(e) => {
              if (
                e.key === "Enter" &&
                !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)
              ) {
                onSubmit(e);
              }
            }}
            placeholder="What do you want to create?"
            value={prompt}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            name="prompt"
          />
{/*           <h4>
            Style
            <HelpTooltip>
              <>
                Enter a well know site like 'jcrew.com'. This will guide the
                look and feel and be used as a basis for any images
              </>
            </HelpTooltip>
          </h4>
          <Input
            placeholder="Use a well recognized site, like 'jcrew.com'"
            value={style}
            onChange={(e) => setStyle(e.currentTarget.value)}
            name="style"
          /> */}
          {/* <h4>
            OpenAI Key
            <HelpTooltip interactive>
              <>
                Please{" "}
                <TooltipTextLink href="https://platform.openai.com/signup">
                  create an account
                </TooltipTextLink>{" "}
                with{" "}
                <TooltipTextLink href="https://platform.openai.com/overview">
                  OpenAI
                </TooltipTextLink>{" "}
                and provide then grab your{" "}
                <TooltipTextLink href="https://platform.openai.com/account/api-keys">
                  API key
                </TooltipTextLink>{" "}
                and put it here. Be sure that you have{" "}
                <TooltipTextLink href="https://platform.openai.com/account/billing/overview">
                  billing
                </TooltipTextLink>{" "}
                <TooltipTextLink href="https://help.openai.com/en/articles/6891831-error-code-429-you-exceeded-your-current-quota-please-check-your-plan-and-billing-details">
                  turned on
                </TooltipTextLink>
                .
              </>
            </HelpTooltip>
          </h4>
          <Input
            value={openAiKey}
            onChange={(e) => setOpenAiKey(e.currentTarget.value)}
            type="password"
            placeholder="sk-********************"
            name="key"
          /> */}

          <Button
            disabled={!(prompt && style)}
            style={{ marginTop: 15 }}
            variant="contained"
            type="submit"
            fullWidth
            color="primary"
          >
            Generate
          </Button>
          <style>{`h4 { margin: 11px 0 7px }`}</style>
        </form>
        {error && (
          <div
            style={{
              color: "rgba(255, 40, 40, 1)",
              marginBottom: 10,
              backgroundColor: "rgba(255, 0, 0, 0.1)",
              padding: 10,
              borderRadius: 5,
              whiteSpace: "pre-wrap",
            }}
          >
            {error}
          </div>
        )}
        {loading && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              flexDirection: "column",
            }}
          >
            <CircularProgress style={{ margin: "10 auto" }} disableShrink />
            {typeof loading === "string" && (
              <div style={{ margin: "10 auto" }}>{loading}</div>
            )}
          </div>
        )}
        {/* <TextLink
          target="_blank"
          href="https://www.builder.io/blog/ai-figma"
          style={{
            color: theme.colors.primary,
            border: `1px solid ${theme.colors.primaryWithOpacity(0.2)}`,
            fontWeight: "bold",
            padding: 10,
            borderRadius: 5,
            backgroundColor: theme.colors.primaryWithOpacity(0.1),
            display: "flex",
            alignItems: "center",
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          <HelpOutline style={{ marginRight: 10 }} />
          Learn how to use this feature
        </TextLink> */}
      </div>
      {hasPreviews() && (
        <div
          style={{
            backgroundColor: "#f9f9f9",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 10,
            padding: 20,
            height: 670,
            marginLeft: -1,
            borderLeft: "1px solid #ccc",
            position: "fixed",
            right: 0,
            zIndex: 5,
            top: 0,
            width: `calc(100% - ${settings.ui.baseWidth - 1}px)`,
            overflow: "auto",
          }}
        >
          {previews.map((preview, index) => (
            <div
              role="button"
              key={index}
              style={{
                width: "300px",
                height: "300px",
                background: "white",
                position: "relative",
                borderRadius: "4px",
                overflow: "hidden",
                cursor: "pointer",
                border: "1px solid #ccc",
              }}
              onClick={async () => {
                setLoading("Importing...");
                setPreviews(defaultPreviews());
                abortControllerRef.current?.abort();
                abortControllerRef.current = new AbortController();

                fetch(`${apiHost}/api/v1/url-to-figma?width=1200`, {
                  method: "POST",
                  signal: abortControllerRef.current.signal,
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    html: `<div style="font-family:Arial,Helvetica,sans-serif;">${preview}</div>`,
                  }),
                })
                  .then((res) => {
                    if (!res.ok) {
                      console.error("Url-to-figma failed", res);
                      amplitude.track("import for ai error");
                      throw new Error("Url-to-figma failed");
                    }
                    amplitude.incrementUserProps("import_count");
                    amplitude.track("import to figma for ai", {
                      type: "url",
                    });
                    return res.json();
                  })
                  .then((data) => {
                    const layers = data.layers;
                    return Promise.all(
                      [data].concat(
                        layers.map(async (rootLayer: Node) => {
                          await traverseLayers(
                            rootLayer as any,
                            (layer: any) => {
                              if (getImageFills(layer)) {
                                return processImages(layer).catch((err) => {
                                  console.warn("Could not process image", err);
                                });
                              }
                            }
                          );
                        })
                      )
                    );
                  })
                  .then((data) => {
                    parent.postMessage(
                      {
                        pluginMessage: {
                          type: "import",
                          data: data[0],
                          blurImages: true,
                        },
                      },
                      "*"
                    );
                  })
                  .catch((err) => {
                    console.error(err);
                    setLoading(false);
                    alert(err);
                  });
              }}
            >
              <div
                style={{
                  width: "300%",
                  height: "300%",
                  transform: "scale(0.3333)",
                  position: "absolute",
                  top: "0",
                  left: "0",
                  transformOrigin: "top left",
                  overflow: "auto",
                }}
              >
                <div
                  style={{
                    pointerEvents: "none",
                  }}
                  dangerouslySetInnerHTML={{ __html: preview }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
