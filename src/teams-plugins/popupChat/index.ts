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
      const url = `https://teams.microsoft.com/l/chat/${props.conversationData.internalId}/conversations`;

      // In Tauri, window.open with a features string is not handled like a browser popup.
      // Use the Tauri WebviewWindow API to create a proper new window instead.
      if (window.__TAURI__) {
        console.log("Opening chat in popup using Tauri WebviewWindow API");
        const { WebviewWindow } = window.__TAURI__.webviewWindow;
        new WebviewWindow(`chat-popup-${Date.now()}`, {
          url,
          width: 600,
          height: 800,
          title: "Chat",
        });
      } else {
        console.log("Opening chat in popup using window.open");
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
            "$1const popupChatButton=tbgProps=>$self.renderCustomNameButton(tbgProps,$2,$3);",
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
