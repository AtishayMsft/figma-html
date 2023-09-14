import * as React from "react";
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
import { initializeIcons, Callout, TooltipHost, Stack, List, mergeStyleSets, TextField, PrimaryButton,Separator,FontIcon, IList } from '@fluentui/react';
import { SparkleFilled } from '@fluentui/react-icons';
import {
  AttachmentMenu,
  AttachmentMenuItem,
  AttachmentMenuList,
  AttachmentMenuPopover,
  AttachmentMenuTrigger,
  AttachmentTag,
  CopilotProvider,
  FeedbackButtons,
  LatencyCancel,
  LatencyLoader,
  LatencyWrapper,
  OutputCard,
  PromptStarter,
  Suggestion,
  SuggestionList,
} from "@fluentai/react-copilot";
import type { AttachmentTagDismissedData } from "@fluentai/react-copilot";
import { Textarea } from "@fluentai/textarea";
import {
  Body1,
  Button,
  Image,
  Link,
  MenuButton,
  makeStyles,
  shorthands,
  tokens,
  webLightTheme,
  FluentProvider,
} from "@fluentui/react-components";
import {
  AppFolder16Regular,
  Attach16Regular,
  Mail16Regular,
  Mail20Regular,
  SparkleRegular,
  Sparkle16Regular,
} from "@fluentui/react-icons";
import { Chat, ChatMessage, ChatMyMessage } from "@fluentui-contrib/react-chat";

interface CopilotMessage {
  type: string;
  origin: string;
  destination: string;
  content: string;
  htmlOld?: string;
  htmlNew?: string;
  htmlDesign?: string;
  imageOld?: string;
  imageNew?: string;
  imageDesign?: string;
  figmaFileId?: string;
}

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

interface IPrompt {
  text: String;
}

interface UIMessage {
  text: String;
  mType: String;
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

const socketUrl = "wss://designercopilotservicefhlsept2023.azurewebsites.net/ws";
//const socketUrl = 'wss://localhost:7246/ws';

function defaultImages() {
  return Array.from({ length: numPreviews }, () => defaultImage);
}

export function DesignerCopilot(props: {
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
  const [updates, setUpdates] = React.useState<string[]>([]);
  const [socket, setSocket] = React.useState<WebSocket | null>(null);
  const [openAiKey, setOpenAiKey] = React.useState(
    props.clientStorage?.openAiKey
  );
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean | string>(false);
  const [matchingFigmaDesigns, setMatchingFigmaDesigns] = React.useState<string[]>([]);

  const [savedHtmlOld, setSavedHtmlOld] = React.useState<string>();
  const [savedHtmlNew, setSavedHtmlNew] = React.useState<string>();
  const [messageList, setMessageList] = React.useState<UIMessage[]>([]);
  const [lastPromptOutput, setLastPromptOutput] = React.useState<string>();

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
    setupWebSocketConnection();
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);

  }, []);

  function setupWebSocketConnection() {
    var socketInstance = new WebSocket(socketUrl);
    setSocket(socketInstance);
  
    // WebSocket onopen event handler
    socketInstance.addEventListener("open", (event) => {
      console.log("WebSocket connection opened:", event);
    
      // You can send data to the server after the connection is open
      const request: CopilotMessage = {
        type: 'handshake',
        origin: 'designer',
        destination: 'server',
        content: 'Starting handshake',
      };
      socketInstance.send(JSON.stringify(request));
    });
    
    // WebSocket onmessage event handler
    socketInstance.addEventListener("message", (event) => {
      console.log("Message from server:", event.data);
      const response = JSON.parse(event.data) as CopilotMessage;
      setUpdates(updates => [...updates, event.data])
      if (response.type === 'GenerateDesign' || response.type === 'GenerateDesignEngageDesigner' || response.type === 'IncorporateFeedback') {
        setSavedHtmlOld(savedHtmlNew);
        setSavedHtmlNew(response.htmlNew!);
        setLastPromptOutput(response.content);
        console.log("SavedHtmlNew",savedHtmlNew);
        setCardContent(
          <>
            <Body1>
              {response.content}
            </Body1>
            <div>
              <div>
                <FeedbackButtons />
              </div>
            </div>
          </>
        );
        setLoadingState("done");
        importHtmlviabuilderApi(response.htmlNew!);
      }
      if (response.type === 'SendDesignToProductManager' || response.type === 'SendDesignToDeveloper' || response.type === "TeamsCommunication" || response.destination === 'all') {
        setMessageList(messageList => [...messageList, {text: response.content, mType: 'comms'}])
      }
    });
    
    // WebSocket onerror event handler
    socketInstance.addEventListener("error", (event) => {
      console.error("WebSocket error:", event);
    });
    
    // WebSocket onclose event handler
    socketInstance.addEventListener("close", (event) => {
      console.log("WebSocket connection closed:", event);
    
      // You can add reconnection logic here if needed
    });
    
    // Close the WebSocket connection when you're done
    // socket.close();
  }

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
      console.log(socket);
      socket?.send(prompt);

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
        let validResponse = false;
        console.log(responseText)
          const match = responseText.match(/```([^`]+)```/);
          if (responseText.startsWith("<")) {
            validResponse = true;
            importHtmlviabuilderApi(responseText);
          } else if (match) {
            console.log(match[1]);
            let htmlContent = match[1];
            if (htmlContent.slice(0, 4) === "html") {
              htmlContent = htmlContent.slice(4);
            }
            validResponse = true;
            importHtmlviabuilderApi(htmlContent);
          }

          if(!validResponse) {
            setError("Your prompt did not generate a valid design.");
            setLoading(false);
            setPrompts([]);
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
  
  const useStyles = makeStyles({
    provider: {
      maxWidth: "500px",
      backgroundColor: tokens.colorNeutralBackground3,
      ...shorthands.padding("16px"),
      ...shorthands.borderRadius("12px"),
      display: "flex",
      columnGap: "24px",
      flexDirection: "column",
      height: "500px",
    },
    latencyWrapper: {
      paddingTop: "16px",
      alignItems: "stretch",
    },
    tag: {
      maxWidth: "100%",
    },
    chat: {
      ...shorthands.padding(0, "16px", "16px"),
      overflowY: "scroll",
      height: "100%",
      marginLeft: `calc(${tokens.spacingHorizontalL} * -1)`,
      "&::-webkit-scrollbar-thumb": {
        backgroundColor: tokens.colorNeutralForeground4,
        ...shorthands.border("2px", "solid", tokens.colorNeutralBackground3),
        ...shorthands.borderRadius(tokens.borderRadiusMedium),
      },
      "&::-webkit-scrollbar-track": {
        backgroundColor: tokens.colorNeutralBackground3,
      },
      "&::-webkit-scrollbar": {
        width: tokens.spacingHorizontalS,
      },
    },
    chatMessage: {
      display: "block",
      marginLeft: 0,
    },
    chatMessageBody: {
      backgroundColor: tokens.colorNeutralBackground1,
      boxShadow: tokens.shadow4,
      boxSizing: "content-box",
      display: "block",
      maxWidth: "100%",
    },
    chatMyMessage: {
      gridTemplateAreas: "unset",
      marginLeft: 0,
    },
    chatMyMessageBody: {
      backgroundColor: "#E0E7FF",
    },
    inputArea: {
      paddingTop: "16px",
    },
    card: {
      rowGap: tokens.spacingHorizontalM,
    },
    prompts: {
      display: "flex",
      flexDirection: "column",
      rowGap: tokens.spacingHorizontalS,
    },
    promptHighlight: {
      color: tokens.colorBrandForegroundLink,
    },
    latency: {
      display: "flex",
      flexDirection: "column",
      width: "100%",
      ...shorthands.gap("8px"),
    },
  });
  
  const [loadingState, setLoadingState] = React.useState<
    "latency" | "loading" | "done" | undefined
  >(undefined);
  const [text, setText] = React.useState<string | undefined>("");
  const [latencyMessage, setLatencyMessage] = React.useState<string>("");
  const [cardContent, setCardContent] = React.useState<
    React.ReactNode | undefined
  >(
    <Body1 block>
      Here are some documents that have relevant information for the marketing
      campaign meeting:
    </Body1>
  );

  const menuButtonRef = React.useRef<HTMLButtonElement>(null);

  const handleReload = (e: React.MouseEvent<HTMLButtonElement>) => {
    console.log("Reload");
  };

  const handleSubmit = () => {
    console.log("SavedHtmlNew", savedHtmlNew);
    const request: CopilotMessage = {
      type: 'request',
      origin: 'designer',
      destination: 'server',
      content: text || '',
      htmlNew: savedHtmlNew,
      htmlOld: savedHtmlOld,
      figmaFileId: 'Fz6kiM6aNMafkqFTsobEEs',
    };
    
    socket!.send(JSON.stringify(request));
    if (lastPromptOutput) {
      setMessageList(messageList => [...messageList, {text: lastPromptOutput!, mType: 'copilot'}, {text: text!, mType: 'my'}])
    }
    else {
      setMessageList(messageList => [...messageList, {text: text!, mType: 'my'}])
    }
    setText("");
    setCardContent("");
    setLatencyMessage("Reading the message");
    setLoadingState("latency");
    setTimeout(() => {
      setLatencyMessage("Thinking about it...");
    }, 6000);
    setTimeout(() => {
      setLatencyMessage("Almost there...");
    }, 3000);
  };
  const scrollDiv = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    scrollDiv.current?.scrollTo({ top: scrollDiv.current.scrollHeight });
  });

  const styles = useStyles();

  return (
    <FluentProvider theme={webLightTheme}>
    <CopilotProvider className={styles.provider} mode='canvas'>
      <Chat ref={scrollDiv} className={styles.chat}>
      <OutputCard className={styles.card}>
          <Body1>Hi Kat,</Body1>

          <Body1>
            Ready to explore? Select one of the suggestions below to get
            started...
          </Body1>

          <div className={styles.prompts}>
            <PromptStarter
              icon={<AppFolder16Regular />}
              category="Summarize"
              prompt={
                <Body1>
                  Review key points in{" "}
                  <span className={styles.promptHighlight}>file</span>
                </Body1>
              }
            />

            <PromptStarter
              icon={<AppFolder16Regular />}
              category="Create"
              prompt={<Body1>Write more about...</Body1>}
            />

            <PromptStarter
              icon={<AppFolder16Regular />}
              category="Ask"
              prompt={<Body1>Tell me about my day</Body1>}
              badge="NEW"
            />
          </div>
          <Body1>
            You can use the prompt guide for suggestions by selecting this
            button <Sparkle16Regular />
          </Body1>
        </OutputCard>
        {messageList.map((item, index) => (
          item.mType === 'my' ? ( 
            <ChatMyMessage
          body={{ className: styles.chatMyMessageBody }}
          root={{ className: styles.chatMyMessage }}
        >
          {item.text}
        </ChatMyMessage>)
        : (<ChatMessage
          body={{ className: styles.chatMessageBody }}
          root={{ className: styles.chatMessage }}
        >
          {item.text}
        </ChatMessage>)
        ))}

        {loadingState !== undefined ? (
          loadingState === "latency" ? (
            <LatencyWrapper className={styles.latencyWrapper}>
              <LatencyLoader header={latencyMessage} className={styles.latency}>
                {latencyMessage === "Almost here..." && (
                  <AttachmentTag
                    className={styles.tag}
                    media={<Mail16Regular />}
                    content="Q4 stuff"
                  />
                )}
              </LatencyLoader>
              <LatencyCancel>Cancel</LatencyCancel>
            </LatencyWrapper>
          ) : (
            <ChatMessage
              body={{
                children: (_, props) => (
                  <OutputCard isLoading={loadingState === "loading"} {...props}>
                    {cardContent}
                  </OutputCard>
                ),

                className: styles.chatMessageBody,
              }}
              root={{
                className: styles.chatMessage,
              }}
            ></ChatMessage>
          )
        ) : null}
      </Chat>

      <div className={styles.inputArea}>
        <SuggestionList>
          <Suggestion onClick={handleSubmit}>
            Share design with my team
          </Suggestion>
        </SuggestionList>
        <Textarea
          contentAfter={
            <>
              <Button
                aria-label="Copilot guide"
                appearance="transparent"
                icon={<SparkleRegular />}
              />
            </>
          }
          onChange={(e, d) => setText(d.value)}
          onSubmit={handleSubmit}
          value={text}
        />
      </div>
    </CopilotProvider>
    </FluentProvider>
  );
  // return (
  //   <Stack>
  //     <Stack horizontal>
  //       <div className={classNames.header}>
  //       <div className={classNames.commandBar}>
  //         <FontIcon iconName="Color" className={classNames.icon}/>
  //         <Text variant={'xLarge'}>  Design</Text>
  //       </div>
  //       <TooltipHost content="Coming soon">
  //         <div>
  //           <FontIcon iconName="CodeEdit" className={classNames.icon}/>
  //           <Text variant={'xLarge'}>  Develop</Text>
  //         </div>
  //       </TooltipHost>
  //       </div>
  //     </Stack>
  //     <Separator />
  //     <div className={classNames.container} data-is-scrollable>
  //     <List items={(prompts.map((p)=>({text:p}))) as IPrompt[]} onRenderCell={onRenderPrompt} componentRef={listRef}/>
  //     </div>
  //     <Separator />
  //     {updates.length > 0 &&(
  //       <div>
  //         {updates.map((item: string, index: number) => (
  //         <Text key={'Update_' + index}>{item}<br/></Text>
  //         ))}
  //       </div>
  //     )}
  //     {!loading && matchingFigmaDesigns.length > 0 && (
  //         <div
  //           style={{
  //             display: "flex",
  //             justifyContent: "center",
  //             flexDirection: "column",
  //             marginLeft: 12
  //           }}
  //         >
  //           <h4 style={{ marginBottom: 0 }}>Checkout similar designs from Microsoft community</h4>
  //           <ul>
  //             {matchingFigmaDesigns.map((figmaId) => (
  //               <li>
  //                 <a
  //                   href={`https://www.figma.com/file/${figmaId}`}
  //                   target="_blank"
  //                 >
  //                   {figmaId}
  //                 </a>
  //               </li>
  //             ))}
  //           </ul>
  //         </div>
  //       )}
  //     <Separator />
  //     {error && (
  //           <div
  //             style={{
  //               color: "rgba(255, 40, 40, 1)",
  //               marginBottom: 10,
  //               backgroundColor: "rgba(255, 0, 0, 0.1)",
  //               padding: 20,
  //               borderRadius: 5,
  //               whiteSpace: "pre-wrap",
  //             }}
  //           >
  //             {error}
  //           </div>
  //         )}
  //     <TextField
  //         value={prompt}
  //         onChange={onChangePrompt}
  //         onKeyPress={(e: React.KeyboardEvent) => {
  //           if (
  //             e.key === "Enter" &&
  //             !(e.shiftKey || e.ctrlKey || e.altKey || e.metaKey)
  //           ) {
  //             onSubmit(e);
  //           }
  //         }}
  //         styles={{
  //           fieldGroup: [{
  //             padding: 10,
  //             boxSizing: 'border-box',
  //             border: `1px solid lightblue`,
  //             margin: 10,
  //             display: 'flex',
  //             borderRadius: 10,
  //           }]}}
  //           placeholder={"Make a design request"} multiline rows={6} resizable={false} />
  //     {!loading && (<PrimaryButton styles={{root:[{margin:10, borderRadius: 8}]}} text="Generate" onClick={onSubmit}/>)}
  //         {loading && (
  //           <div
  //             style={{
  //               display: "flex",
  //               justifyContent: "center",
  //               flexDirection: "column",
  //             }}
  //           >
  //             <CircularProgress style={{ margin: "10 auto" }} disableShrink />
  //           </div>
  //         )}
  //   </Stack>
  // );


}
