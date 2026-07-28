import React from "react";
import { Devs } from "../../data/devs";
import { Plugin } from "../../interface";
import createIcon from "../../utils/icon";
import linkSVGUrl from "../../svgs/link.svg";

interface PopupChatPlugin extends Plugin {
  renderCustomNameButton(
    props: { selectedId: string; conversationData: { internalId: string } },
    createElement: typeof React.createElement,
    component: string,
  ): unknown;
}

const popupChat: PopupChatPlugin = {
  name: "PopupChat",
  description: "Enable popup chat functionality.",
  author: Devs.LeonimusT,

  renderCustomNameButton(props, createElement, component) {
    const onClick = (e?: MouseEvent) => {
      e?.stopPropagation();
      const chatId = props.conversationData.internalId;

      // In Tauri, window.open with a features string is not handled like a browser popup,
      // and a plain `new WebviewWindow(...)` popup never loads Teams correctly: it's missing
      // the injection script (Teams' webpack loader needs the Trusted Types policy hijack it
      // performs) and the spoofed desktop user agent, neither of which can be set from the
      // frontend. Ask the Rust side to build the popup instead, so it's configured exactly
      // like the main window.
      if (window.__TAURI__) {
        console.log(
          "Opening chat in popup using Tauri invoke(open_chat_popup)",
        );
        window.__TAURI__.core
          .invoke("open_chat_popup", { chatId })
          .catch((error: unknown) => {
            console.error("Failed to open chat popup:", error);
          });
      } else {
        console.log("Opening chat in popup using window.open");
        const url = `https://teams.microsoft.com/l/chat/${chatId}/conversations`;
        window.open(url, "_blank", "width=600,height=800");
      }
    };

    return createElement(component, {
      icon: createIcon(linkSVGUrl, createElement),
      onClick,
      "data-testid": "open-chat-in-popup-button",
      children: "Open chat in popup",
    });
  },

  patches: [
    {
      find: "chat-manage-apps-menu-item",
      replacement: [
        {
          match:
            /(return\(0,(\w+\.\w+)\)\((\w+\.\w+),{icon:\(0,\w+\.\w+\)\((\w+\.\w+),{}\),onClick:(\w+),"data-testid":"chat-manage-apps-menu-item",children:(\w+)}\)};)/,
          replace:
            "$1const popupChatButton=i=>$self.renderCustomNameButton(i,$2,$3);",
        },
        {
          match:
            /(\(0,(\w+.\w+)\)\(\w+,{conversationData:(\w+),simpleCollabViewData:\w+,selectedId:(\w+).selectedId}\),)/,
          replace:
            "$1(0,$2)(popupChatButton,{conversationData:$3,selectedId:$4.selectedId}),",
        },
      ],
    },
  ],
};

export default popupChat;
