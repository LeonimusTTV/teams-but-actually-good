import { Devs } from "../../data/devs";
import { Plugin } from "../../interface";
import { IPluginOptionComponentProps, OptionType } from "../../types/types";
import * as React from "react";

function ChannelSelectorComponent({
  setValue,
  value,
  ReactLib,
}: IPluginOptionComponentProps) {
  void ReactLib;
  const plugin = window.__TEAMS_PLUGINS__?.[betterInputBar.name] as
    | BetterInputBarPlugin
    | undefined;
  const channels: Array<{ key: string; name: string }> =
    plugin?.availableInputButtons ?? [];
  const selected: string[] =
    Array.isArray(value) && value.length > 0
      ? value
      : channels.map((c: { key: string; name: string }) => c.key);

  if (channels.length === 0) {
    /** @jsx ReactLib.createElement */
    return (
      <p className="tbg-setting-description">
        No Input buttons have been detected yet, enable the plugin first.
      </p>
    );
  }

  /** @jsx ReactLib.createElement */
  return (
    <div className="tbg-channel-selector">
      {channels.map(({ key, name }: { key: string; name: string }) => (
        <label
          key={key}
          className="tbg-channel-option"
          style={{
            display: "flex",
            gap: "6px",
            alignItems: "center",
            cursor: "pointer",
            padding: "4px 0",
          }}
        >
          <input
            type="checkbox"
            checked={selected.includes(key)}
            onChange={() => {
              const next = selected.includes(key)
                ? selected.filter((k: string) => k !== key)
                : [...selected, key];
              setValue(next);
            }}
          />{" "}
          {name}
        </label>
      ))}
    </div>
  );
}

interface BetterInputBarPlugin extends Plugin {
  availableInputButtons: Array<{ key: string; name: string }>;
  filterInputBarItems(inputBarDataId: string, inputBarTitle: string): boolean;
  logStuff(stuff: string | object): string | object;
}

const betterInputBar: BetterInputBarPlugin = {
  name: "BetterInputBar",
  description: "Remove useless buttons from the input bar.",
  author: Devs.LeonimusT,
  availableInputButtons: [] as Array<{ key: string; name: string }>,
  settingsDef: {
    selectedButtons: {
      type: OptionType.COMPONENT,
      component: ChannelSelectorComponent,
      default: [],
      restartNeeded: true,
    },
  },

  filterInputBarItems(inputBarDataId: string, inputBarTitle: string) {
    if (!inputBarDataId || !inputBarTitle) return true;

    inputBarDataId = inputBarDataId
      .replace("newMessageCommands-", "")
      .replace("sendMessageCommands-", "");

    // check if key already exists, if not add it to
    if (
      !this.availableInputButtons.some(
        (btn: { key: string; name: string }) => btn.key === inputBarDataId,
      )
    ) {
      console.log(
        `[BetterInputBar] Adding input bar item to available buttons: ${inputBarTitle} (${inputBarDataId})`,
      );
      this.availableInputButtons.push({
        key: inputBarDataId,
        name: inputBarTitle,
      });
    }

    const selected: string[] = Array.isArray(this.settings?.selectedButtons)
      ? (this.settings.selectedButtons as string[])
      : [];

    if (selected.length === 0) return true;

    return selected.includes(inputBarDataId);
  },

  logStuff(stuff: string | object) {
    console.log("[BetterInputBar] logStuff:", stuff);
    return stuff;
  },

  patches: [
    {
      find: '"enableComposeToolbarButtonsTooltip"]',
      replacement: [
        {
          match:
            /(dataTid:([\w$]+),icon:[\w$]+,onClick:[\w$]+,active:[\w$]+,disabled:[\w$]+,hidden:[\w$]+,content:[\w$]+,as:[\w$]+,renderV9Toolbar:[\w$]+,shouldAnimateButton:[\w$]+,isPopupOpen:[\w$]+,title:([\w$]+),currentSelectedOption:[\w$]+,setCurrentSelectedOption:[\w$]+,\.\.\.[\w$]+\}\)=>\{)/,
          replace:
            "$1let keepItem=$self.filterInputBarItems($2,$3);if(!keepItem){return null;}",
          //"$1$self.logStuff($2,$3);",
        },
        {
          match:
            /(dataTid:([\w$]+),icon:[\w$]+,onClick:[\w$]+,active:[\w$]+,disabled:[\w$]+,hidden:[\w$]+,content:[\w$]+,as:[\w$]+,renderV9Toolbar:[\w$]+,shouldAnimateButton:[\w$]+,isPopupOpen:[\w$]+,title:([\w$]+),tooltipRelationship:[\w$]+="label",currentSelectedOption:[\w$]+,setCurrentSelectedOption:[\w$]+,\.\.\.[\w$]+\}\)=>\{)/,
          replace:
            "$1let keepItem=$self.filterInputBarItems($2,$3);if(!keepItem){return null;}",
        },
      ],
    },
    {
      find: "fluid_convert_text_to_loop_create",
      replacement: [
        {
          match:
            /(buttonProps:[\w$]+,name:(\w+),title:(\w+),onActionClick:\w+,onMouseOver:\w+\}=\w+;)/,
          replace:
            "$1let keepItem=$self.filterInputBarItems($2,$3);if(!keepItem){return null;}",
        },
      ],
    },
  ],
};

export default betterInputBar;
