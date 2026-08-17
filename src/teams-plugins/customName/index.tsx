import { Plugin } from "../../interface";
import { IPluginOptionComponentProps, OptionType } from "../../types/types";
import { getPluginSetting, setPluginSetting } from "../../utils/storage";
import * as React from "react";
import userSVGUrl from "../../svgs/user.svg";
import createIcon from "../../utils/icon";
import { injectNotificationModal } from "../../utils/notifications";
import { Devs } from "../../data/devs";

type UserInfo = Array<{
  id: string;
  customName: string;
  defaultName: string;
}>;

let userList: UserInfo = [];
let pollingInterval: ReturnType<typeof setInterval> | null = null;

interface CustomNamePlugin extends Plugin {
  showModal(internalId: string): void;
  renderCustomNameButton(
    props: { selectedId: string; conversationData: { internalId: string } },
    createElement: typeof React.createElement,
    component: string,
  ): unknown;
}

type ConversationRecord = {
  chatTitle: {
    avatarUsersInfo: {
      displayName: string;
    }[];
    shortTitle: string;
    longTitle: string;
  };
  id: string;
};

async function main() {
  userList = (await getPluginSetting(customName.name, "userList")) as UserInfo;

  if (!userList) {
    userList = [];
  }

  const db = await getConversationDB();

  // check if the db is accessible, if not we can't do much so we just return and hope the user restarts Teams or opens the right view to make it accessible, which will trigger the name edits to be applied through the watcher
  if (!db) {
    return;
  }

  await getAllUsersFromDB();

  await setPluginSetting(customName.name, "userList", userList);

  await applyNameEdits();

  startWatching();
}

// small polling to detect changes in the conversation list and apply name edits, since there's no event we can subscribe to for that
async function startWatching() {
  if (pollingInterval) return;

  let lastSnapshot = "";

  pollingInterval = setInterval(async () => {
    const db = await getConversationDB();
    const tx = db!.transaction("conversations", "readonly");
    const store = tx.objectStore("conversations");
    const records: ConversationRecord[] = await new Promise(
      (res) =>
        (store.getAll().onsuccess = (e) =>
          res((e.target as IDBRequest).result)),
    );
    db!.close();

    // small hash to see if anything changed since last check, to avoid unnecessary writes to the DB
    const snapshot = records
      .map((r) => r?.chatTitle?.avatarUsersInfo?.[0]?.displayName)
      .join("|");

    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot;
      console.log("Changes detected, applying name edits...");
      await applyNameEdits();
    }
  }, 2000);
}

async function getConversationDB() {
  const allDbs = await indexedDB.databases();
  const target = allDbs.find((db) => {
    if (!db.name) return false;
    return db.name.startsWith("Teams:conversation-manager:react-web-client:");
  });

  if (!target) {
    console.error("DB introuvable");
    return null;
  }

  const db: IDBDatabase = await new Promise((resolve, reject) => {
    const req = indexedDB.open(target.name as string, target.version);
    req.onsuccess = (e) => {
      resolve((e.target as IDBOpenDBRequest).result);
    };
    req.onerror = (e) => {
      reject((e.target as IDBOpenDBRequest).error);
    };
  });

  return db;
}

async function getAllUsersFromDB() {
  const db = await getConversationDB();

  const tx = db!.transaction("conversations", "readonly");
  const store = tx.objectStore("conversations");
  const records: ConversationRecord[] = await new Promise(
    (res) =>
      (store.getAll().onsuccess = (e) => res((e.target as IDBRequest).result)),
  );

  for (const record of records) {
    if (!record?.chatTitle?.avatarUsersInfo?.[0]?.displayName) continue;
    const userInfo = record.chatTitle.avatarUsersInfo[0];
    if (userList.some((user) => user.id === record.id)) continue;

    if (record.id.includes("@thread.v2") || record.id.includes(":metting_"))
      continue;

    userList.push({
      id: record.id,
      customName: "",
      defaultName: userInfo.displayName,
    });
  }
}

async function applyNameEdits(reset: boolean = false) {
  const db = await getConversationDB();

  const tx = db!.transaction("conversations", "readwrite");
  const store = tx.objectStore("conversations");
  const records: ConversationRecord[] = await new Promise(
    (res) =>
      (store.getAll().onsuccess = (e) => res((e.target as IDBRequest).result)),
  );

  for (const record of records) {
    if (!record?.chatTitle?.avatarUsersInfo?.[0]?.displayName) continue;

    const user = userList.find((user) => user.id === record.id);
    if (!user) continue;

    record.chatTitle.avatarUsersInfo[0].displayName = reset
      ? user.defaultName
      : user.customName || user.defaultName;
    record.chatTitle.shortTitle = reset
      ? user.defaultName
      : user.customName || user.defaultName;
    record.chatTitle.longTitle = reset
      ? user.defaultName
      : user.customName || user.defaultName;
    store.put(record);
  }

  await new Promise((res) => (tx.oncomplete = res));
  db!.close();
}

function resetButton({ ReactLib }: IPluginOptionComponentProps) {
  void ReactLib;

  const handleReset = async () => {
    console.log("Resetting custom names...");
    await applyNameEdits(true);
    setPluginSetting(customName.name, "userList", []);
    userList = [];
    window.location.reload();
  };

  /** @jsx ReactLib.createElement */
  return (
    <button className="tbg-button-primary" onClick={handleReset}>
      Reset all custom names (requires reload)
    </button>
  );
}

const customName: CustomNamePlugin = {
  name: "CustomName",
  description: "Change the name of people in Teams.",
  author: Devs.LeonimusT,
  mainEntry: main,
  settingsDef: {
    resetButton: {
      type: OptionType.COMPONENT,
      component: resetButton,
    },
  },

  showModal(internalId: string) {
    const user = userList.find((u) => u.id === internalId);
    if (!user) {
      console.error("User not found by ID", internalId);
      return;
    }
    // Tear down any stale dialog so the DOM stays fresh
    document.getElementById("tbg-customname-dialog")?.remove();

    const close = () => backdrop.remove();

    const handleSave = async () => {
      setPluginSetting(customName.name, "userList", userList);
      await applyNameEdits();
      injectNotificationModal(
        "Display name updated",
        "Your changes have been saved. Please restart Teams to see the changes.",
      );
      close();
      // window.location.reload();
    };

    const backdrop = document.createElement("div");
    backdrop.id = "tbg-customname-dialog";
    backdrop.className = "tbg-modal-backdrop";
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });

    document.addEventListener("keydown", function onKeyDown(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", onKeyDown);
      }
    });

    const modal = document.createElement("div");
    modal.className = "tbg-modal";

    // Header
    const header = document.createElement("div");
    header.className = "tbg-modal-header";

    const title = document.createElement("span");
    title.className = "tbg-modal-title";
    title.textContent = `Edit display name of ${user.defaultName}`;

    const closeBtn = document.createElement("button");
    closeBtn.className = "tbg-modal-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "x";
    closeBtn.addEventListener("click", close);

    header.append(title, closeBtn);

    // Body
    const body = document.createElement("div");
    body.className = "tbg-modal-body";

    const input = document.createElement("input");
    input.className = "tbg-input";
    input.type = "text";
    input.placeholder = "New display name";
    input.value = user.customName || user.defaultName;

    body.appendChild(input);

    const restartNotice = document.createElement("span");
    restartNotice.className = "tbg-setting-restart";
    restartNotice.textContent = "Changes will apply after restarting Teams.";
    body.appendChild(restartNotice);

    // Footer
    const footer = document.createElement("div");
    footer.className = "tbg-modal-footer";

    const saveBtn = document.createElement("button");
    saveBtn.className = "tbg-button-primary";
    saveBtn.style.marginBottom = "5px";
    saveBtn.textContent = "Save and close";
    saveBtn.addEventListener("click", async () => {
      user.customName = input.value.trim();

      handleSave();
    });

    const resetBtn = document.createElement("button");
    resetBtn.className = "tbg-button-secondary";
    resetBtn.textContent = "Reset and close";
    resetBtn.addEventListener("click", async () => {
      input.value = "";
      user.customName = "";

      handleSave();
    });

    footer.append(saveBtn, resetBtn);

    modal.append(header, body, footer);
    backdrop.appendChild(modal);
    const mountTarget =
      document.querySelector<HTMLElement>(".fui-FluentProvider") ??
      document.body;
    mountTarget.appendChild(backdrop);
    input.focus();
  },

  renderCustomNameButton(props, createElement, component) {
    const onClick = (e?: MouseEvent) => {
      e?.stopPropagation();
      this.showModal(props.conversationData.internalId);
    };

    return createElement(component, {
      icon: createIcon(userSVGUrl, createElement),
      onClick,
      "data-testid": "edit-display-name-menu-item",
      children: "Edit display name",
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
            "$1const customNameButton=tbgProps=>$self.renderCustomNameButton(tbgProps,$2,$3);",
        },
        {
          match:
            /(\(0,(\w+.\w+)\)\(\w+,{conversationData:(\w+),simpleCollabViewData:\w+,selectedId:(\w+).selectedId}\),)/,
          replace:
            "$1(0,$2)(customNameButton,{conversationData:$3,selectedId:$4.selectedId}),",
        },
      ],
    },
  ],
};

export default customName;
