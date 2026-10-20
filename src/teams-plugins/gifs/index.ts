import { Devs } from "../../data/devs";
import { Plugin } from "../../interface";
import { KiplyGifResponse } from "../../types/types";

const TEAMS_IMAGE_URL_FIELD_NAMES = [
  "image",
  "previewImage",
  "previewImageFW",
  "previewImageFH",
];

const TEAMS_IMAGE_WIDTH_FIELD_NAMES = [
  "width",
  "previewImageWidth",
  "previewImageFWWidth",
  "previewImageFHWidth",
];

const TEAMS_IMAGE_HEIGHT_FIELD_NAMES = [
  "height",
  "previewImageHeight",
  "previewImageFWHeight",
  "previewImageFHHeight",
];

const GIF_ITEM_BASE = {
  composeValue: "url",
  composeType: "Image",
  fieldValues: [
    {
      fieldName: "title",
      fieldValue: "title",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "image",
      fieldValue: "url",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "previewImage",
      fieldValue: "url",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "previewImageFW",
      fieldValue: "url",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "previewImageFH",
      fieldValue: "url",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "width",
      fieldValue: "480",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "height",
      fieldValue: "480",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "previewImageWidth",
      fieldValue: "100",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "previewImageHeight",
      fieldValue: "100",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "previewImageFWWidth",
      fieldValue: "200",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "previewImageFWHeight",
      fieldValue: "200",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "previewImageFHWidth",
      fieldValue: "200",
      __typename: "GiphyFieldValues",
    },
    {
      fieldName: "previewImageFHHeight",
      fieldValue: "200",
      __typename: "GiphyFieldValues",
    },
  ],
  __typename: "Giphy",
};

const kiplyCache = new Map<string, { data: { data: KiplyGifResponse[] } }>();
let currentSearchTerm = "";
let categoryOpened = "";

async function fetchKiply(search: string): Promise<void> {
  if (kiplyCache.has(search)) return;
  try {
    const response = await fetch(
      `https://api.klipy.com/api/v1/web/gifs/search?q=${encodeURIComponent(search)}&locale=en-US&page=1&per_page=36`,
      {
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.9,fr;q=0.8",
          "cache-control": "no-cache",
          pragma: "no-cache",
          priority: "u=1, i",
          "sec-ch-ua": '"Chromium";v="145", "Not:A-Brand";v="99"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-site",
          Referer: "https://klipy.com/",
        },
        body: null,
        method: "GET",
      },
    );
    const data = await response.json();
    kiplyCache.set(search, data);

    setTimeout(() => {
      const plugin = window.__TEAMS_PLUGINS__?.["BetterGifs"] as
        | GifsPlugin
        | undefined;
      plugin?.setUpdate?.((n: number) => n + 1);
      plugin?.setUpdateUnifiedGifPicker?.((n: number) => n + 1);
    }, 0);
  } catch (err) {
    console.error("[BetterGifs] fetch failed:", err);
  }
}

function addEventListenerToInput() {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  document.addEventListener("input", (event) => {
    const target = event.target as HTMLElement;
    if (!target.matches('input[data-tid="unified-picker-search-bar"]')) return;
    const value = (target as HTMLInputElement).value;
    currentSearchTerm = value;

    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (value) fetchKiply(value);
      debounceTimer = null;
    }, 300);
  });

  document.addEventListener("click", () => {
    setTimeout(() => {
      const input = document.querySelector(
        'input[data-tid="unified-picker-search-bar"]',
      ) as HTMLInputElement | null;
      if (!input || input.value === currentSearchTerm) return;
      currentSearchTerm = input.value;
      if (input.value) fetchKiply(input.value);
    }, 0);
  });
}

type GifItem = {
  fieldValues: Array<{ fieldName: string; fieldValue: string | number }>;
  [key: string]: unknown;
};

type GifChild = { key: string; props: Record<string, unknown> };

interface GifsPlugin extends Plugin {
  setUpdate: ((...args: unknown[]) => void) | null;
  setUpdateUnifiedGifPicker: ((...args: unknown[]) => void) | null;
  isKiplyLoading(): boolean;
  gifPicker(items: GifItem[], customSearchTerm?: string): GifItem[];
  changeDefaultCategories(categories: GifChild[]): GifChild[];
  defaultGifsSearch(children: GifChild[]): GifChild[];
  manageGifsCategoryEmojis(children: GifChild[]): GifChild[];
  setCategoryOpened(category: string): string;
}

const betterGifs: GifsPlugin = {
  name: "BetterGifs",
  description: "Use Kiply for gifs.",
  author: Devs.LeonimusT,
  setUpdate: null,
  setUpdateUnifiedGifPicker: null,

  isKiplyLoading(): boolean {
    return (
      (!!currentSearchTerm && !kiplyCache.has(currentSearchTerm)) ||
      (!!categoryOpened && !kiplyCache.has(categoryOpened))
    );
  },

  gifPicker(
    items: Array<{
      fieldValues: Array<{ fieldName: string; fieldValue: string | number }>;
    }>,
    customSearchTerm: string = "",
  ) {
    const gifs = kiplyCache.get(
      currentSearchTerm
        ? currentSearchTerm
        : customSearchTerm
          ? customSearchTerm
          : categoryOpened,
    );

    if (!gifs) return items;

    const gifList: KiplyGifResponse[] = gifs.data.data;

    if (items.length === 0) {
      items.push(...Array(gifs.data.data.length).fill(GIF_ITEM_BASE));
    }

    const mappedGifs = items.map((item, index) => {
      const gif = gifList[index % gifList.length];
      const gifData = gif.file.hd.gif;
      const clone = { ...item, composeValue: gifData.url };
      clone.fieldValues = (item.fieldValues ?? []).map(
        (field: { fieldValue: string | number; fieldName: string }) => {
          const f = { ...field };
          if (TEAMS_IMAGE_URL_FIELD_NAMES.includes(f.fieldName)) {
            f.fieldValue = gifData.url;
          }
          if (TEAMS_IMAGE_HEIGHT_FIELD_NAMES.includes(f.fieldName)) {
            f.fieldValue = gifData.height;
          }
          if (TEAMS_IMAGE_WIDTH_FIELD_NAMES.includes(f.fieldName)) {
            f.fieldValue = gifData.width;
          }
          if (f.fieldName === "title") {
            f.fieldValue = gif.title || "Untitled Gif";
          }
          return f;
        },
      );
      return clone;
    });

    return mappedGifs;
  },

  changeDefaultCategories(categories: GifChild[]) {
    categories[1].props.src =
      "https://static.klipy.com/ii/35ccce3d852f7995dd2da910f2abd795/77/6b/K1tmEAl8.webp";
    categories[2].props.src =
      "https://static.klipy.com/ii/71b2873e478b9d8d0482ea3ec777ba7f/0d/58/KA6RC8a5.gif";
    categories[3].props.src =
      "https://static.klipy.com/ii/c3a19a0b747a76e98651f2b9a3cca5ff/35/fe/JUiTVkaE.webp";
    categories[4].props.src =
      "https://static.klipy.com/ii/4e7bea9f7a3371424e6c16ebc93252fe/7a/38/V1BFae4sQXh7Y.webp";
    categories[5].props.src =
      "https://static.klipy.com/ii/c3a19a0b747a76e98651f2b9a3cca5ff/95/8d/yCz64xWe.webp";
    categories[6].props.src =
      "https://static.klipy.com/ii/ce286d05b8e1a47cd4f32b0e1b6dec0e/7e/bc/mJ3xruBq.webp";
    categories[7].props.src =
      "https://static.klipy.com/ii/84b4c0b02782dda9051003f9e36484ec/1b/2a/h8c2IrV0.webp";

    return categories;
  },

  defaultGifsSearch(children: GifChild[]) {
    fetchKiply(currentSearchTerm || "cats");

    const gifs: GifItem[] = [];
    for (const gif of children) {
      gifs.push(gif.props.gif as GifItem);
    }

    const kiplyGif = this.gifPicker(gifs, currentSearchTerm || "cats");
    for (let i = 0; i < children.length; i++) {
      children[i].props.gif = kiplyGif[i];
    }

    return children;
  },

  manageGifsCategoryEmojis(children: GifChild[]) {
    if (children[0]?.key == "0" && children[0]?.props?.gif != null) {
      return this.defaultGifsSearch(children);
    }

    if (children[0]?.key != "") return children;

    return this.changeDefaultCategories(children);
  },

  setCategoryOpened(category: string) {
    categoryOpened = category;
    fetchKiply(category);
    return category;
  },

  patches: [
    {
      find: '"unified-picker-giphys-content"',
      replacement: [
        /*{
          match: /(\w+,\{items:)(\w+)(,isLoading:)(\w+)(\})/,
          replace: "$1$self.gifPicker($2)$3($4||$self.isKiplyLoading())$5",
        },*/
        {
          match: /(=\({items:)(\w+)(,isLoading:)(\w+)(}\)=>{)/,
          replace:
            "$1$2$3$4$5$2=$self.gifPicker($2);$4=$4||$self.isKiplyLoading();",
        },
        {
          match: /(\w\.useCallback\(\w+=>\(\)=>\w+\()(\w+)(\),\[\w+\]\))/,
          replace: "$1$self.setCategoryOpened($2)$3",
        },
        {
          match: /(\[\w+,\w+\])=(\w+\.useState\(""\))/,
          replace: "$1=($self._r=$2,$self.setUpdate=$self._r[1],$self._r)",
        },
      ],
    },
    {
      find: /"fui-Grid",\w+=\w+\.forwardRef/,
      replacement: {
        match: /(const\{rows:\w+,columns:\w+,className:\w+,\.\.\.\w+\}=(\w+))/,
        replace: "$2.children=$self.manageGifsCategoryEmojis($2.children);$1",
      },
    },
    {
      find: '="unified_picker_gifs_section_title',
      replacement: [
        {
          match: /(\w+)(\.useEffect\()/,
          replace:
            "($self._r2=$1.useState(0),$self.setUpdateUnifiedGifPicker=$self._r2[1]),$1$2",
        },
      ],
    },
  ],

  mainEntry: addEventListenerToInput,
};

export default betterGifs;
