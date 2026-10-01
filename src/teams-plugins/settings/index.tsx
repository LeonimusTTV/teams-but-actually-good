import { Plugin, pluginRegistry } from "../../interface";
import * as React from "react";
import { injectStyles } from "../../utils/styles";
import styles from "./index.css";
import cogwheelUrl from "../../svgs/cogwheel.svg";
import infoUrl from "../../svgs/info.svg";
import { updatePluginSettings } from "../../utils/storage";
import SettingModal from "./modal";
import { Devs } from "../../data/devs";
import { OptionType } from "../../types/types";
import Themes from "./themes";
import Testing from "./testing";
import Sync from "./sync";

injectStyles(styles, "teams-but-good-settings");

interface SettingsPluginType extends Plugin {
  addNewChildren(elementsProp: {
    children?: Array<{
      key: string;
      ref?: unknown;
      props?: {
        children?: Array<{
          key: string;
          ref?: unknown;
          props?: Record<string, unknown>;
        }>;
        [key: string]: unknown;
      };
    }>;
    "aria-label"?: string;
  }): typeof elementsProp;
  changeName(value: string): string;
  addCustomContent(ReactLib: typeof React): React.JSX.Element;
}

const settingsPlugin: SettingsPluginType = {
  name: "Settings",
  description: "Adds custom settings tabs to Teams settings panel",
  enableByDefault: true,
  author: Devs.LeonimusT,
  settingsDef: {
    enableThemes: {
      type: OptionType.BOOLEAN,
      description: "Enable custom themes",
      default: true,
      restartNeeded: true,
    },
    enableTesting: {
      type: OptionType.BOOLEAN,
      description: "Enable testing section",
      default: true,
      restartNeeded: true,
    },
  },

  addNewChildren(elementsProp: {
    children?: Array<{
      key: string;
      ref?: unknown;
      props?: {
        children?: Array<{
          key: string;
          ref?: unknown;
          props?: Record<string, unknown>;
        }>;
        [key: string]: unknown;
      };
    }>;
    "aria-label"?: string;
  }) {
    const rootChildren = elementsProp?.children;
    if (!Array.isArray(rootChildren) || !elementsProp["aria-label"]) {
      return elementsProp;
    }

    const navigationPane = rootChildren[1];
    const categoryPane = rootChildren[2];
    const navigationChildren = navigationPane?.props?.children;
    const categoryChildren = categoryPane?.props?.children;

    if (
      !Array.isArray(navigationChildren) ||
      !Array.isArray(categoryChildren) ||
      categoryChildren.some(
        (child: { key: string }) => child?.key === "plugin_settings",
      )
    ) {
      return elementsProp;
    }

    const template = categoryChildren.find(
      (child: { key: string }) => child?.key === "general",
    );
    if (!template?.props) {
      return elementsProp;
    }

    const newChild = {
      ...template,
      key: "plugin_settings",
      ref: null,
      props: {
        ...template.props,
        category: "plugin_settings",
        isActive: categoryPane.key === "plugin_settings",
      },
    };

    const newChildrenTwo = [newChild, ...categoryChildren];

    const newChildrenOne = [newChild, ...navigationChildren];

    const nextRootChildren = [...rootChildren];
    nextRootChildren[1] = {
      ...navigationPane,
      props: {
        ...navigationPane.props,
        children: newChildrenOne,
      },
    };
    nextRootChildren[2] = {
      ...categoryPane,
      props: {
        ...categoryPane.props,
        children: newChildrenTwo,
      },
    };

    return {
      ...elementsProp,
      children: nextRootChildren,
    };
  },

  changeName(value: string) {
    if (value === "plugin_settings") {
      return "Teams but (actually) good Settings";
    }
    return value;
  },

  addCustomContent(ReactLib: typeof React) {
    const [needRestart, setNeedRestart] = ReactLib.useState(false);
    const [activePlugin, setActivePlugin] = ReactLib.useState<Plugin | null>(
      null,
    );
    function handleCheckboxChange(checked: boolean, pluginName: string) {
      setNeedRestart(true);
      updatePluginSettings(pluginName, {
        enabled: checked,
      });
    }
    // We basically say that we wanna use ReactLib to create the elements instead of our React.
    /** @jsx ReactLib.createElement */
    return (
      <div>
        <div className="tbg-container">
          <div className="tbg-default-display-flex">
            <img
              src={cogwheelUrl}
              style={{
                height: "17px",
                filter: "brightness(0) invert(1)",
              }}
              aria-hidden="true"
            />
            <span>Plugins</span>
          </div>
          <div className="tbg-plugin-container">
            {Object.values(pluginRegistry).flatMap((plugin) => (
              <div className="tbg-plugins-grid">
                <div className="tbg-box-basic">
                  <div className="tbg-plugin-header">
                    <span className="tbg-plugin-name">{plugin.name}</span>
                    <div className="tbg-plugin-controls">
                      {plugin.settingsDef &&
                      Object.keys(plugin.settingsDef).length > 0 ? (
                        <button
                          className="tbg-cog-button"
                          aria-label="Plugin settings"
                          title="Configure plugin"
                          onClick={() => setActivePlugin(plugin)}
                        >
                          <img
                            src={cogwheelUrl}
                            style={{
                              width: "1em",
                              filter: "brightness(0) invert(1)",
                            }}
                            aria-hidden="true"
                          />
                        </button>
                      ) : (
                        <button
                          className="tbg-cog-button"
                          aria-label="Plugin settings"
                          title="Configure plugin"
                          onClick={() => setActivePlugin(plugin)}
                        >
                          <img
                            src={infoUrl}
                            style={{
                              width: "1em",
                              filter: "brightness(0) invert(1)",
                            }}
                            aria-hidden="true"
                          />
                        </button>
                      )}
                      <div
                        className={
                          "tbg-switch" +
                          (plugin.enableByDefault ? " tbg-switch-disabled" : "")
                        }
                        role="switch"
                        tabIndex={0}
                        data-checked={String(
                          pluginRegistry[plugin.name]?.enable === true,
                        )}
                        onClick={(e: React.MouseEvent<HTMLDivElement>) => {
                          if (plugin.enableByDefault) {
                            return;
                          }
                          const target = e.currentTarget;
                          const next = target.dataset.checked !== "true";
                          target.dataset.checked = String(next);
                          handleCheckboxChange(next, plugin.name);
                        }}
                        onKeyDown={(e: React.KeyboardEvent<HTMLDivElement>) => {
                          if (e.key === " " || e.key === "Enter") {
                            e.preventDefault();
                            e.currentTarget.click();
                          }
                        }}
                      >
                        <div className="tbg-switch__indicator">
                          <svg
                            fill="currentColor"
                            aria-hidden="true"
                            width="1em"
                            height="1em"
                            viewBox="0 0 20 20"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z"
                              fill="currentColor"
                            ></path>
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>
                  <p className="tbg-plugin-description">{plugin.description}</p>
                </div>
              </div>
            ))}
          </div>
          {needRestart && (
            <div
              className="tbg-modal-footer"
              style={{
                border: "none",
                paddingRight: 0,
                paddingLeft: 0,
                paddingBottom: 0,
                paddingTop: "15px",
              }}
            >
              <button
                className="tbg-button-primary"
                onClick={() => window.location.reload()}
              >
                Restart Teams to apply changes
              </button>
            </div>
          )}
          {activePlugin && (
            <SettingModal
              ReactLib={ReactLib}
              plugin={activePlugin}
              onClose={() => setActivePlugin(null)}
              needRestart={needRestart}
              setNeedRestart={setNeedRestart}
            />
          )}
        </div>
        {Boolean(
          pluginRegistry[settingsPlugin.name]?.settings &&
          typeof pluginRegistry[settingsPlugin.name].settings?.enableThemes ===
            "boolean" &&
          pluginRegistry[settingsPlugin.name].settings?.enableThemes,
        ) && <Themes ReactLib={ReactLib} />}
        <Sync ReactLib={ReactLib} />
        {Boolean(
          pluginRegistry[settingsPlugin.name]?.settings &&
          typeof pluginRegistry[settingsPlugin.name].settings?.enableTesting ===
            "boolean" &&
          pluginRegistry[settingsPlugin.name].settings?.enableTesting,
        ) && <Testing ReactLib={ReactLib} />}
      </div>
    );
  },

  // Plugin patches
  patches: [
    {
      find: 'smaller:"8px",small:"10px",medium:"15px",large:"30px"',
      replacement: {
        match: /(forwardRef\(function\((\w+),\w+\)\{)/,
        replace: "$1$2=$self.addNewChildren($2);",
      },
    },
    {
      find: "category content goes here",
      replacement: {
        match:
          /=>\(0,\w+\.Y\)\("div",\{children:`\$\{\w+\} category content goes here`\}\),(\w+=(\w+)\.memo)/,
        replace: "=>$self.addCustomContent($2),$1",
      },
    },
    {
      find: /:"{{title}}",/,
      replacement: [
        {
          match: /(:"{{title}}",)/,
          replace: '$1plugin_settings:"Teams But (actually) Good Settings",',
        },
        {
          match: /(kc6evthtk:)"Apparence",/,
          replace: '$1"Teams",',
        },
      ],
    },
    {
      find: /:"{{title}} \({{participantsCount}}\)",/,
      replacement: [
        {
          match: /(:"{{title}} \({{participantsCount}}\)",)/,
          replace: '$1plugin_settings:"Teams But (actually) Good Settings",',
        },
        {
          match: /(kc6evthtk:)"Apparence",/,
          replace: '$1"Teams",',
        },
      ],
    },
    {
      find: '("framework","accessibility_juno");return(0',
      replacement: [
        {
          match: /(\[\w+\.\w+\.TeamsLabs]:(\w+\.\w+))/,
          replace: "$1,['plugin_settings']:$2",
        },
      ],
    },
    // to show the custom emojis, so user don't need to enable the custom emoji plugin
    {
      find: "?.emojiPickerConfigurationViewModel??{},[",
      replacement: {
        // \w doesn't match "$", but minified vars can be named "$"
        match: /=[\w$]+\|\|![\w$]+\|\|![\w$]+/,
        replace: "=false",
      },
    },
  ],
};

export default settingsPlugin;
