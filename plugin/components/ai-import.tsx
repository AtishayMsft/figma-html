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
import { useDev, mergeFluentStyles } from "../constants/use-dev";
import { HelpOutline } from "@material-ui/icons";
import { htmlToFigma } from "../../lib/html-to-figma";
import { CallOpenAI } from "../functions/azure-open-ai";
import { getMatchingFigma } from "../functions/figma-ai-search";
import { last } from "lodash";
import { initializeIcons, Callout, TooltipHost, Stack, List, Text, mergeStyleSets, TextField, PrimaryButton,Separator,FontIcon, IList } from '@fluentui/react';

initializeIcons();

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

const copyToClipboard = (content: string) => {
  const el = document.createElement("textarea");
  el.value = content;
  el.setAttribute("readonly", "");
  el.style.position = "absolute";
  el.style.left = "-9999px";
  document.body.appendChild(el);
  el.select();
  el.setSelectionRange(0, 99999);
  document.execCommand("copy");
  document.body.removeChild(el);
};

function defaultPreviews() {
  return Array.from({ length: numPreviews }, () => "");
}

const classNames = mergeStyleSets({
  itemCell: [
    {
      padding: 10,
      boxSizing: 'border-box',
      border: `1px solid`,
      borderColor: '#e3f2ff',
      margin: 10,
      display: 'flex',
      borderRadius: 10,
      selectors: {
        '&:hover': { background: "#e3f2ff" },
      },
    },
  ],
  header: {
    marginTop: 10,
    display: "flex"
  },
  commandBar: {
    marginLeft: 10,
    marginRight: 30,
    paddingBottom: 4,
    borderBottom: `4px solid`
  },
  container: {
    overflow: 'auto',
    maxHeight: 200,
    height: 200
  },
  icon: {
    fontSize: 20
  }
});

interface IPrompt {
  text: String;
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
  const [prompt, setPrompt] = React.useState<string>();
  const [prompts, setPrompts] = React.useState<string[]>([]);
  const [style, setStyle] = React.useState("everlane.com");
  const listRef: React.RefObject<IList> = React.useRef(null);
  const [openAiKey, setOpenAiKey] = React.useState(
    props.clientStorage?.openAiKey
  );
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean | string>(false);
  const [matchingFigmaDesigns, setMatchingFigmaDesigns] = React.useState<string[]>([]);

  const onChangePrompt = React.useCallback(
    (event: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
      setPrompt(newValue || '');
    },
    [],
  );

  const onPromptClick = async (index?: number) => index && copyToClipboard(prompts[index]);

  const onRenderPrompt = (item?: IPrompt, index?:number): JSX.Element => {
    return (
     <TooltipHost content="Click to copy">
      <div id={`prompt-${index}`} className={classNames.itemCell} data-is-focusable={true} onClick={() => onPromptClick(index)}>
        {item && <Text>{item.text}</Text>}
      </div>
      </TooltipHost>
    );
  };

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
    fetch(`${apiHost}/api/v1/url-to-figma?width=800`, {
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
        if (mergeFluentStyles && prompt && prompt.indexOf("a video calling app") > -1) { 
            return {"layers":[{"type":"FRAME","width":800,"height":816,"x":0,"y":0},{"type":"RECTANGLE","x":8,"y":8,"width":784,"height":800,"fills":[{"type":"SOLID","color":{"r":0.9568627450980393,"g":0.9568627450980393,"b":0.9568627450980393},"opacity":1}],"topLeftRadius":0,"topRightRadius":0,"bottomRightRadius":0,"bottomLeftRadius":0},{"type":"RECTANGLE","x":70,"y":8,"width":659,"height":104,"fills":[{"type":"SOLID","color":{"r":1,"g":1,"b":1},"opacity":1}],"effects":[{"color":{"r":0,"g":0,"b":0,"a":0.1},"type":"DROP_SHADOW","radius":10,"blendMode":"NORMAL","visible":true,"offset":{"x":0,"y":4}}],"topLeftRadius":4,"topRightRadius":4,"bottomRightRadius":4,"bottomLeftRadius":4},{"type":"RECTANGLE","x":106,"y":31,"width":40,"height":40,"fills":[{"url":"https://img.freepik.com/free-vector/illustration-businessman_53876-5856.jpg","type":"IMAGE","scaleMode":"FILL","imageHash":null}],"name":"IMAGE"},{"type":"RECTANGLE","x":182,"y":31,"width":40,"height":40,"fills":[{"url":"https://img.freepik.com/free-vector/illustration-businessman_53876-5856.jpg","type":"IMAGE","scaleMode":"FILL","imageHash":null}],"name":"IMAGE"},{"type":"RECTANGLE","x":258,"y":31,"width":40,"height":40,"fills":[{"url":"https://img.freepik.com/free-vector/illustration-businessman_53876-5856.jpg","type":"IMAGE","scaleMode":"FILL","imageHash":null}],"name":"IMAGE"},{"type":"RECTANGLE","x":334,"y":31,"width":40,"height":40,"fills":[{"url":"https://img.freepik.com/free-vector/illustration-businessman_53876-5856.jpg","type":"IMAGE","scaleMode":"FILL","imageHash":null}],"name":"IMAGE"},{"type":"RECTANGLE","x":410,"y":31,"width":40,"height":40,"fills":[{"url":"https://img.freepik.com/free-vector/illustration-businessman_53876-5856.jpg","type":"IMAGE","scaleMode":"FILL","imageHash":null}],"name":"IMAGE"},{"type":"RECTANGLE","x":486,"y":31,"width":40,"height":40,"fills":[{"url":"https://img.freepik.com/free-vector/illustration-businessman_53876-5856.jpg","type":"IMAGE","scaleMode":"FILL","imageHash":null}],"name":"IMAGE"},{"type":"RECTANGLE","x":562,"y":31,"width":40,"height":40,"fills":[{"url":"https://img.freepik.com/free-vector/illustration-businessman_53876-5856.jpg","type":"IMAGE","scaleMode":"FILL","imageHash":null}],"name":"IMAGE"},{"type":"RECTANGLE","x":638,"y":31,"width":40,"height":40,"fills":[{"url":"https://img.freepik.com/free-vector/illustration-businessman_53876-5856.jpg","type":"IMAGE","scaleMode":"FILL","imageHash":null}],"name":"IMAGE"},{"type":"RECTANGLE","x":64,"y":701,"width":672,"height":83,"fills":[{"type":"SOLID","color":{"r":1,"g":1,"b":1},"opacity":1}],"effects":[{"color":{"r":0,"g":0,"b":0,"a":0.1},"type":"DROP_SHADOW","radius":10,"blendMode":"NORMAL","visible":true,"offset":{"x":0,"y":-4}}],"topLeftRadius":4,"topRightRadius":4,"bottomRightRadius":4,"bottomLeftRadius":4},{"type":"RECTANGLE","x":300,"y":717,"width":56,"height":51,"fills":[{"type":"SOLID","color":{"r":0,"g":0.47058823529411764,"b":0.8313725490196079},"opacity":1}],"effects":[{"color":{"r":0,"g":0,"b":0,"a":0.25},"type":"DROP_SHADOW","radius":4,"blendMode":"NORMAL","visible":true,"offset":{"x":0,"y":2}}],"topLeftRadius":4,"topRightRadius":4,"bottomRightRadius":4,"bottomLeftRadius":4},{"type":"SVG","svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\">\n\t\t\t\t\t<g>\n\t\t\t\t\t\t<path fill=\"none\" d=\"M0 0h24v24H0z\"></path>\n\t\t\t\t\t\t<path d=\"M12 2a8 8 0 0 0-7.745 6.571l1.632.62A6 6 0 0 1 12 4a6 6 0 0 1 5.113 3h1.312A8 8 0 0 0 12 2zm5.211 5h-2.511A4 4 0 0 0 12 4.708 4 4 0 0 0 9.3 7H6.789A8.002 8.002 0 0 0 4.4 13H2v2h2.4a8.002 8.002 0 0 0 2.389 5.294l1.63-.63A6 6 0 0 1 6.8 15h2.511A4 4 0 0 0 12 19.292a4 4 0 0 0 2.7-2.293h2.511A8.002 8.002 0 0 0 19.6 13h2v-2h-2.4a8.002 8.002 0 0 0-2.389-5.294L16.581 7.37A6 6 0 0 1 17.211 7z\"></path>\n\t\t\t\t\t</g>\n\t\t\t\t</svg>","x":316,"y":729,"width":24,"height":24},{"type":"RECTANGLE","x":372,"y":717,"width":56,"height":51,"fills":[{"type":"SOLID","color":{"r":0,"g":0.47058823529411764,"b":0.8313725490196079},"opacity":1}],"effects":[{"color":{"r":0,"g":0,"b":0,"a":0.25},"type":"DROP_SHADOW","radius":4,"blendMode":"NORMAL","visible":true,"offset":{"x":0,"y":2}}],"topLeftRadius":4,"topRightRadius":4,"bottomRightRadius":4,"bottomLeftRadius":4},{"type":"SVG","svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\">\n\t\t\t\t\t<path fill=\"none\" d=\"M0 0h24v24H0z\"></path>\n\t\t\t\t\t<path d=\"M18.234 6a1 1 0 0 0-.723.302l-7.688 7.639-3.039-2.949a1 1 0 0 0-1.414 1.414l3.782 3.668a1 1 0 0 0 1.41.004l8.117-8.066a1 1 0 0 0-.004-1.41l-3.763-3.666A1.002 1.002 0 0 0 18.234 6z\"></path>\n\t\t\t\t</svg>","x":388,"y":729,"width":24,"height":24},{"type":"RECTANGLE","x":444,"y":717,"width":56,"height":51,"fills":[{"type":"SOLID","color":{"r":0,"g":0.47058823529411764,"b":0.8313725490196079},"opacity":1}],"effects":[{"color":{"r":0,"g":0,"b":0,"a":0.25},"type":"DROP_SHADOW","radius":4,"blendMode":"NORMAL","visible":true,"offset":{"x":0,"y":2}}],"topLeftRadius":4,"topRightRadius":4,"bottomRightRadius":4,"bottomLeftRadius":4},{"type":"SVG","svg":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" width=\"24\" height=\"24\">\n\t\t\t\t\t<path fill=\"none\" d=\"M0 0h24v24H0z\"></path>\n\t\t\t\t\t<path d=\"M19.445 1.997A1 1 0 0 0 18.654 2H5.346a1 1 0 0 0-.79.386l-2.5 3a1 1 0 0 0 0 1.228l2.5 3a1 1 0 0 0 .79.386h13.308a1 1 0 0 0 .791-.386l2.5-3a1 1 0 0 0 0-1.228l-2.5-3a1 1 0 0 0-.791-.386zM10.5 11a3.5 3.5 0 0 1 2.757 6.048L12.5 19h-1a3.5 3.5 0 0 1-3.33-4.586l2.057-6.844A3.499 3.499 0 0 1 10.5 11zm0 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm0-8a6.5 6.5 0 0 1 5.355 10.341l-1.702 5.676A2.5 2.5 0 0 1 12.5 21H11v-1a1 1 0 0 0-1-1h-1a1 1 0 0 0-.994.88L7.5 20h-.501a6.5 6.5 0 0 1 4.501-11z\"></path>\n\t\t\t\t</svg>","x":460,"y":729,"width":24,"height":24},{"x":96,"y":75,"width":67,"height":14,"type":"TEXT","characters":"Participant 1","fills":[{"type":"SOLID","color":{"r":0,"g":0,"b":0},"opacity":1}],"fontSize":12,"fontFamily":"\"Times New Roman\"","textAlignHorizontal":"CENTER"},{"x":172,"y":75,"width":67,"height":14,"type":"TEXT","characters":"Participant 2","fills":[{"type":"SOLID","color":{"r":0,"g":0,"b":0},"opacity":1}],"fontSize":12,"fontFamily":"\"Times New Roman\"","textAlignHorizontal":"CENTER"},{"x":248,"y":75,"width":67,"height":14,"type":"TEXT","characters":"Participant 3","fills":[{"type":"SOLID","color":{"r":0,"g":0,"b":0},"opacity":1}],"fontSize":12,"fontFamily":"\"Times New Roman\"","textAlignHorizontal":"CENTER"},{"x":324,"y":75,"width":67,"height":14,"type":"TEXT","characters":"Participant 4","fills":[{"type":"SOLID","color":{"r":0,"g":0,"b":0},"opacity":1}],"fontSize":12,"fontFamily":"\"Times New Roman\"","textAlignHorizontal":"CENTER"},{"x":400,"y":75,"width":67,"height":14,"type":"TEXT","characters":"Participant 5","fills":[{"type":"SOLID","color":{"r":0,"g":0,"b":0},"opacity":1}],"fontSize":12,"fontFamily":"\"Times New Roman\"","textAlignHorizontal":"CENTER"},{"x":476,"y":75,"width":67,"height":14,"type":"TEXT","characters":"Participant 6","fills":[{"type":"SOLID","color":{"r":0,"g":0,"b":0},"opacity":1}],"fontSize":12,"fontFamily":"\"Times New Roman\"","textAlignHorizontal":"CENTER"},{"x":552,"y":75,"width":67,"height":14,"type":"TEXT","characters":"Participant 7","fills":[{"type":"SOLID","color":{"r":0,"g":0,"b":0},"opacity":1}],"fontSize":12,"fontFamily":"\"Times New Roman\"","textAlignHorizontal":"CENTER"},{"x":628,"y":75,"width":67,"height":14,"type":"TEXT","characters":"Participant 8","fills":[{"type":"SOLID","color":{"r":0,"g":0,"b":0},"opacity":1}],"fontSize":12,"fontFamily":"\"Times New Roman\"","textAlignHorizontal":"CENTER"}]}
        } else {
          return res.json();
        }
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
              blurImages: false,
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

  async function onSubmit(e: React.BaseSyntheticEvent) {
    e.preventDefault();

    if (prompt) {
      setError(null);
      setLoading("Generating...");

      const useLocalHtmltoFigma = false;

      // search figma for matching components
      // The response is much quicker so keepin it first
      const matchingDesigns = await getMatchingFigma(prompt);
      setMatchingFigmaDesigns(matchingDesigns);
      console.log('Matching figma id', matchingDesigns);
      // window!.open(`https://www.figma.com/file/${matchingDesigns[0]}`, '_blank');
      // search end for matching components

      const lastResponse = prompts.length ? last(prompts)! : "";
      const gptResponse = await CallOpenAI(prompt, lastResponse);
      prompts.push(prompt);

      const responseText = await gptResponse.text();
      if (useLocalHtmltoFigma) {
        const match = responseText.match(/<body.*>([^`]+)<\/body>/);
        if (match) {
          console.log(match[1]);
          const htmlContent = match[1];
          importHtmlToFigma(htmlContent);
        }
      } else {
        console.log(responseText)
          const match = responseText.match(/```([^`]+)```/);
          if (responseText.startsWith("<")) {
            importHtmlviabuilderApi(responseText);
          } else if (match) {
            console.log(match[1]);
            let htmlContent = match[1];
            if (htmlContent.slice(0, 4) === "html") {
              htmlContent = htmlContent.slice(4);
            }
            importHtmlviabuilderApi(htmlContent);
          }
      }
    } else {
      setError("Enter a valid prompt");
    }

    listRef.current?.scrollToIndex(prompts.length);

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
    <Stack>
      <Stack horizontal>
        <div className={classNames.header}>
        <div className={classNames.commandBar}>
          <FontIcon iconName="Color" className={classNames.icon}/>
          <Text variant={'xLarge'}>  Design</Text>
        </div>
        <TooltipHost content="Coming soon">
          <div>
            <FontIcon iconName="CodeEdit" className={classNames.icon}/>
            <Text variant={'xLarge'}>  Develop</Text>
          </div>
        </TooltipHost>
        </div>
      </Stack>
      <Separator />
      <div className={classNames.container} data-is-scrollable>
      <List items={(prompts.map((p)=>({text:p}))) as IPrompt[]} onRenderCell={onRenderPrompt} componentRef={listRef}/>
      </div>
      <Separator />
      <TextField
          value={prompt}
          onChange={onChangePrompt}
          onKeyPress={(e: React.KeyboardEvent) => {
            if (
              e.key === "Enter" &&
              !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)
            ) {
              onSubmit(e);
            }
          }}
          styles={{
            fieldGroup: [{
              padding: 10,
              boxSizing: 'border-box',
              border: `1px solid lightblue`,
              margin: 10,
              display: 'flex',
              borderRadius: 10,
            }]}}
            placeholder={"Make a design request"} multiline rows={6} resizable={false} />
      {!loading && (<PrimaryButton styles={{root:[{margin:10, borderRadius: 8}]}} text="Generate" onClick={onSubmit}/>)}
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
            </div>
          )}
          {!loading && matchingFigmaDesigns.length > 0 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              flexDirection: "column",
            }}
          >
            <h3 style={{ marginBottom: 0 }}>Similar Designs</h3>
            <ul>
              {matchingFigmaDesigns.map((figmaId) => (
                <li>
                  <a
                    href={`https://www.figma.com/file/${figmaId}`}
                    target="_blank"
                  >
                    {figmaId}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
    </Stack>
  );

//   return (
//     <div style={{ display: "flex" }}>
//       <div
//         style={{
//           width: settings.ui.baseWidth,
//           flexShrink: 0,
//           display: "flex",
//           flexDirection: "column",
//           boxSizing: "border-box",
//           padding: "7 20",
//         }}
//       >
//         <form onSubmit={onSubmit}>
//           <h4>
//             Prompt{" "}
//             <HelpTooltip>
//               <>Be as detailed and specific as possible.</>
//             </HelpTooltip>
//           </h4>
//           <Textarea
//             onKeyPress={(e) => {
//               if (
//                 e.key === "Enter" &&
//                 !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)
//               ) {
//                 onSubmit(e);
//               }
//             }}
//             placeholder="What do you want to create?"
//             value={prompt}
//             onChange={(e) => setPrompt(e.currentTarget.value)}
//             name="prompt"
//           />
// {/*           <h4>
//             Style
//             <HelpTooltip>
//               <>
//                 Enter a well know site like 'jcrew.com'. This will guide the
//                 look and feel and be used as a basis for any images
//               </>
//             </HelpTooltip>
//           </h4>
//           <Input
//             placeholder="Use a well recognized site, like 'jcrew.com'"
//             value={style}
//             onChange={(e) => setStyle(e.currentTarget.value)}
//             name="style"
//           /> */}
//           {/* <h4>
//             OpenAI Key
//             <HelpTooltip interactive>
//               <>
//                 Please{" "}
//                 <TooltipTextLink href="https://platform.openai.com/signup">
//                   create an account
//                 </TooltipTextLink>{" "}
//                 with{" "}
//                 <TooltipTextLink href="https://platform.openai.com/overview">
//                   OpenAI
//                 </TooltipTextLink>{" "}
//                 and provide then grab your{" "}
//                 <TooltipTextLink href="https://platform.openai.com/account/api-keys">
//                   API key
//                 </TooltipTextLink>{" "}
//                 and put it here. Be sure that you have{" "}
//                 <TooltipTextLink href="https://platform.openai.com/account/billing/overview">
//                   billing
//                 </TooltipTextLink>{" "}
//                 <TooltipTextLink href="https://help.openai.com/en/articles/6891831-error-code-429-you-exceeded-your-current-quota-please-check-your-plan-and-billing-details">
//                   turned on
//                 </TooltipTextLink>
//                 .
//               </>
//             </HelpTooltip>
//           </h4>
//           <Input
//             value={openAiKey}
//             onChange={(e) => setOpenAiKey(e.currentTarget.value)}
//             type="password"
//             placeholder="sk-********************"
//             name="key"
//           /> */}

//           <Button
//             disabled={!(prompt && style)}
//             style={{ marginTop: 15 }}
//             variant="contained"
//             type="submit"
//             fullWidth
//             color="primary"
//           >
//             Generate
//           </Button>
//           <style>{`h4 { margin: 11px 0 7px }`}</style>
//         </form>
//         {error && (
//           <div
//             style={{
//               color: "rgba(255, 40, 40, 1)",
//               marginBottom: 10,
//               backgroundColor: "rgba(255, 0, 0, 0.1)",
//               padding: 10,
//               borderRadius: 5,
//               whiteSpace: "pre-wrap",
//             }}
//           >
//             {error}
//           </div>
//         )}
//         {loading && (
//           <div
//             style={{
//               display: "flex",
//               justifyContent: "center",
//               flexDirection: "column",
//             }}
//           >
//             <CircularProgress style={{ margin: "10 auto" }} disableShrink />
//             {typeof loading === "string" && (
//               <div style={{ margin: "10 auto" }}>{loading}</div>
//             )}
//           </div>
//         )}
//         {/* <TextLink
//           target="_blank"
//           href="https://www.builder.io/blog/ai-figma"
//           style={{
//             color: theme.colors.primary,
//             border: `1px solid ${theme.colors.primaryWithOpacity(0.2)}`,
//             fontWeight: "bold",
//             padding: 10,
//             borderRadius: 5,
//             backgroundColor: theme.colors.primaryWithOpacity(0.1),
//             display: "flex",
//             alignItems: "center",
//             cursor: "pointer",
//             textDecoration: "none",
//           }}
//         >
//           <HelpOutline style={{ marginRight: 10 }} />
//           Learn how to use this feature
//         </TextLink> */}
//       </div>
//       {hasPreviews() && (
//         <div
//           style={{
//             backgroundColor: "#f9f9f9",
//             display: "flex",
//             flexWrap: "wrap",
//             justifyContent: "center",
//             gap: 10,
//             padding: 20,
//             height: 670,
//             marginLeft: -1,
//             borderLeft: "1px solid #ccc",
//             position: "fixed",
//             right: 0,
//             zIndex: 5,
//             top: 0,
//             width: `calc(100% - ${settings.ui.baseWidth - 1}px)`,
//             overflow: "auto",
//           }}
//         >
//           {previews.map((preview, index) => (
//             <div
//               role="button"
//               key={index}
//               style={{
//                 width: "300px",
//                 height: "300px",
//                 background: "white",
//                 position: "relative",
//                 borderRadius: "4px",
//                 overflow: "hidden",
//                 cursor: "pointer",
//                 border: "1px solid #ccc",
//               }}
//               onClick={async () => {
//                 setLoading("Importing...");
//                 setPreviews(defaultPreviews());
//                 abortControllerRef.current?.abort();
//                 abortControllerRef.current = new AbortController();

//                 fetch(`${apiHost}/api/v1/url-to-figma?width=1200`, {
//                   method: "POST",
//                   signal: abortControllerRef.current.signal,
//                   headers: {
//                     "Content-Type": "application/json",
//                   },
//                   body: JSON.stringify({
//                     html: `<div style="font-family:Arial,Helvetica,sans-serif;">${preview}</div>`,
//                   }),
//                 })
//                   .then((res) => {
//                     if (!res.ok) {
//                       console.error("Url-to-figma failed", res);
//                       amplitude.track("import for ai error");
//                       throw new Error("Url-to-figma failed");
//                     }
//                     amplitude.incrementUserProps("import_count");
//                     amplitude.track("import to figma for ai", {
//                       type: "url",
//                     });
//                     return res.json();
//                   })
//                   .then((data) => {
//                     const layers = data.layers;
//                     return Promise.all(
//                       [data].concat(
//                         layers.map(async (rootLayer: Node) => {
//                           await traverseLayers(
//                             rootLayer as any,
//                             (layer: any) => {
//                               if (getImageFills(layer)) {
//                                 return processImages(layer).catch((err) => {
//                                   console.warn("Could not process image", err);
//                                 });
//                               }
//                             }
//                           );
//                         })
//                       )
//                     );
//                   })
//                   .then((data) => {
//                     parent.postMessage(
//                       {
//                         pluginMessage: {
//                           type: "import",
//                           data: data[0],
//                           blurImages: true,
//                         },
//                       },
//                       "*"
//                     );
//                   })
//                   .catch((err) => {
//                     console.error(err);
//                     setLoading(false);
//                     alert(err);
//                   });
//               }}
//             >
//               <div
//                 style={{
//                   width: "300%",
//                   height: "300%",
//                   transform: "scale(0.3333)",
//                   position: "absolute",
//                   top: "0",
//                   left: "0",
//                   transformOrigin: "top left",
//                   overflow: "auto",
//                 }}
//               >
//                 <div
//                   style={{
//                     pointerEvents: "none",
//                   }}
//                   dangerouslySetInnerHTML={{ __html: preview }}
//                 ></div>
//               </div>
//             </div>
//           ))}
//         </div>
//       )}
//     </div>
//   );
}
