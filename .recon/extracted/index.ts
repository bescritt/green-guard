type AdData = {
  type: string;
  timestamp: number;
  ad_links: {
    sub_links: string[];
    ad_redirect_link: string | null;
    shown_domain: string | null;
    link_title: string | null;
    external_url: string | null;
  };
  media_links: string[];
  texts: string[];
  post_id: string | null;
  ad_id: string | null;
  profile_name: string | null;
  profile_id: string | null;
  post_url: string | null;
  ad_lib: string | null;
  device_id: string | null;
  ad_button_text: string | null;
};

let cachedDeviceId: string | null | undefined = undefined;

async function getDeviceId(): Promise<string | null> {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  const result = await chrome.storage.local.get('uuid');
  
  if (result.uuid && typeof result.uuid === 'string') {
    cachedDeviceId = result.uuid;
    return result.uuid;
  }

  cachedDeviceId = null;
  return null;
}


const regexPatterns: Record<string, RegExp[]> = {
  post_id: [/\"post_id\":\s*\"([^"]+)\"/],
  ad_id: [/\"ad_id\":\s*\"([^"]+)\"/],
  profile_name: [
    /"actors"\s*:\s*\[\s*{[\s\S]*?"name"\s*:\s*"([^"]+)"/
  ],
  profile_id: [
    /"actors"\s*:\s*\[\s*\{[^}]*?"id"\s*:\s*"([^"]+)"/
  ],
  post_url: [
    /\"url\":\s*\"([^\"]*permalink\.php[^\"]*)\"/,
    /\"url\":\s*\"(https:\/\/www\.facebook\.com\/[^\/]+\/(posts|videos)\/[^\/"]+\/?)\"/,
    /\"wwwURL\":\s*\"(https:\/\/www\.facebook\.com\/[^\/]+\/(posts|videos)\/[^\/"]+\/?)\"/,
  ],
  text: [/\"text\":\s*\"((?:[^"\\]|\\.)*)\"/],
  ad_lib: [/\"delegate_page\":\s*\{[^}]*\"id\":\s*\"(\d+)\"/],
  ad_redirect_link: [
    /\"action_links\":\s*\[\s*\{[^}]*\"url\":\s*\"([^"]+)\"/,
    /\"destination_type\":\s*\"([^"]+)\"/,
    /\"web_link\":\s*\{\s*\"__typename\":\s*\"ExternalWebLink\",\s*\"url\":\s*\"([^"]+)\"/,
  ],
  shown_domain: [
    /\"link_display\":\s*\"([^"]+)\"/,
    /\"source\":\s*\{\s*\"text\":\s*\"([^"]+)\"/,
  ],
  link_title: [
    /\"link_title\":\s*\"([^"]+)\"/,
    /\"title_with_entities\":\s*\{\s*\"text\":\s*\"([^"]+)\"/,
  ],
  external_url: [/\"external_url\":\s*\"([^"]+)\"/],
  media_links: [
    /"flexible_height_share_image":\s*\{[^}]*"uri":\s*"([^"]+)"/,
    /"large_share_image":\s*\{[^}]*"uri":\s*"([^"]+)"/,
    /"thumbnailImage":\s*\{[^}]*"uri":\s*"([^"]+)"/,
    /"image":\s*\{[^}]*"uri":\s*"([^"]+)"/,
    /\"browser_native_sd_url\":\s*\"([^"]+)\"/,
    /\"browser_native_hd_url\":\s*\"([^"]+)\"/,
  ],
  'ad_button_text': [
    /"destination_type"\s*:\s*"[^"]+"\s*,\s*"stateful_title"\s*:"([^"]+)"/,
    /link_video_endscreen_icon"\s*:\s*{[^}]+}\s*,\s*"title"\s*:\s*"([^"]+)"/
  ]
};

const IGNORED_TEXTS: Set<string> = new Set([
  "Not affiliated with Meta", 
  "Commenting has been turned off for this post.",
  "Les commentaires ont été désactivés pour cette publication.",  
  "评论功能已关闭。", 
  "此貼文的留言功能已關閉。", 
  "Os comentários foram desativados para esse post.",  
  "Os comentários foram desativados para esta publicação.",
  "Komentowanie tego posta zostało wyłączone.",  
  "Se desactivaron los comentarios para esta publicación.",  
  "ได้มีการปิดการแสดงความคิดเห็นไว้สำหรับโพสต์นี้",  
  "Comentariile la această postare au fost oprite.",  
  "I commenti sono stati disattivati per questo post.",  
  "A hozzászólás lehetőségét kikapcsolták ennél a bejegyzésnél.",  
  "Kommentarer er blevet slået fra for dette opslag.",  
  "Opmerkingen zijn uitgeschakeld voor dit bericht.", 
  "Die Kommentarfunktion wurde für diesen Beitrag deaktiviert.",  
  "この投稿ではコメントがオフになっています。",  
  "Η δημιουργία σχολίων έχει απενεργοποιηθεί για αυτή τη δημοσίευση.",  
  "Kommentarer har inaktiverats för det här inlägget.",  
  "此帖子的回應功能已關閉。",  
  "Коментарі до цього допису вимкнені",  
  "Bình luận đã bị tắt cho bài viết này.",  
  "Komentování k tomuto příspěvku bylo vypnuto.", 
  "Komentáře jsou u tohoto příspěvku vypnuté.",  
  "इस पोस्ट पर टिप्पणी करना बंद कर दिया गया है।",  
  "Энэ нийтлэлд сэтгэгдэл үлдээхийг хориглосон байна.",  
  "Kommentarer har blitt slått av for dette innlegget.",  
  "Kommentit eivät ole käytössä tässä julkaisussa.", 
  "Komentovanie tohto príspevku bolo vypnuté.", 
  "Komentari su isključeni za ovu objavu.",  
  "ယခုပို့စ်အတွက် မှတ်ချက်ပေးတာကို ပိတ်ထားပါတယ်။",  
  "Комментарии для этой публикации отключены.",  
  "Sellel postitusel on kommenteerimise võimalus välja lülitatud.", 
  "Se han desactivado los comentarios para esta publicación.",  
  "이 게시물의 댓글 기능이 해제되었습니다.",  
  "Tá tráchtanna múchta don phostáil seo."
])

function getEmptyAdData(): AdData {
  const adData: AdData = {
    type: "generic_ad",
    timestamp: Math.floor(Date.now() / 1000),
    ad_links: {
      sub_links: [],
      ad_redirect_link: null,
      shown_domain: null,
      link_title: null,
      external_url: null,
    },
    media_links: [],
    texts: [],
    post_id: null,
    ad_id: null,
    profile_name: null,
    profile_id: null,
    post_url: null,
    ad_lib: null,
    device_id: null,
    ad_button_text: null,
  };

  return adData;
}

function getSideAdObject(ad: any): AdData {
  const adData: AdData = {
    type: "side_ad",
    timestamp: Math.floor(Date.now() / 1000),
    ad_links: {
      sub_links: [],
      ad_redirect_link: ad.rhc_ad?.web_link?.url || null,
      shown_domain: ad.rhc_ad?.subtitle || null,
      link_title: ad.rhc_ad?.title || null,
      external_url: ad.rhc_ad?.web_link?.url || null,
    },
    media_links: ad.rhc_ad?.image?.uri ? [ad.rhc_ad.image.uri] : (ad.rhc_ad?.attachments?.[0]?.all_subattachments?.nodes?.[0]?.media?.image?.uri ? [ad.rhc_ad?.attachments?.[0]?.all_subattachments?.nodes[0].media.image.uri] : []),
    texts: ad.rhc_ad?.description ? [ad.rhc_ad?.description] : [],
    post_id: null,
    ad_id: ad.sponsored_data?.ad_id || ad.sponsored_data?.id_for_advertisement || null,
    profile_name: ad.rhc_ad?.actor?.name || null,
    profile_id: ad.rhc_ad?.actor?.id || null,
    post_url: null,
    ad_lib: null,
    device_id: null,
    ad_button_text: null
  };
  return adData;
}

const adsProcessedInThisRuntime = new Set<string>();
const SIDE_ADS_FEED_UNIT_NAME = "AdsSideFeedUnit";


chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "content-script") {
    port.onMessage.addListener(async (message) => {
      if (message.type === "GRAPHQL_API_RESPONSE") {
        await processResponseBody(message.data);
      }
    });
  }
});

async function processResponseBody(body: string): Promise<void> {
  const lines = body.split("\n");

  for (const line of lines) {
    try {
      await processJsonLine(line);
    } catch (error) {
      console.error(`Error processing line: ${line}`, error);
    }
  }
}

async function processJsonLine(line: string): Promise<void> {
  try {
    const jsonData = JSON.parse(line);
    if (line.includes('"category":"SPONSORED"')) {
      await processGenericPost(jsonData);
    } else if (line.includes(SIDE_ADS_FEED_UNIT_NAME)) {
      await processSideAdPost(jsonData);
    } else if (line.includes("is_sponsored") || (line.includes("ad_id") && !line.includes(SIDE_ADS_FEED_UNIT_NAME))) {
      const adIdMatch = line.match(/"ad_id":\s*"([^"]+)"/);
      if (adIdMatch) {
        await processGenericPost(jsonData);
      }
    }
  } catch (error) {
    console.error("Invalid JSON line:", line);
  }
}

function getSideAdsContainer(jsonData: any): any[] | null {
  const viewer = jsonData?.data?.viewer;
  if (!viewer) return null;
  const sideFeedKey = Object.keys(viewer).find(key => 
    key.toLowerCase().startsWith('sidefeed')
  );

  if (sideFeedKey) {
    return viewer[sideFeedKey]?.nodes || null;
  }

  return null;
}

async function processSideAdPost(jsonData: any) {
  let adsContainer = getSideAdsContainer(jsonData);

  const actualAds = adsContainer?.[0]?.ads?.nodes;
  const secondaryActualAds = adsContainer?.[0]?.new_adverts?.nodes;
  const allAds = [...(actualAds ?? []), ...(secondaryActualAds ?? [])];

  if (allAds.length > 0) {
    await processSideAdsFeed(allAds);
  }
}

async function processGenericPost(jsonData: any): Promise<void> {
  const jsonString = JSON.stringify(jsonData);
  const adData: AdData = getEmptyAdData();
  
  for (const key in regexPatterns) {
    const regexArray = regexPatterns[key];

    if (key === "media_links") {
      for (const regex of regexArray) {
        const match = jsonString.match(regex);
        if (match) {
          adData.media_links.push(match[1]);
        }
      }
      continue;
    }
    if (key === "text") {
      const textRegex = /(?<!"body")(?<!"source")(?<!\"title_with_entities\"):{\"(text|link_description)\":\s*\"((?:[^"\\]|\\.)*)\"/g;
      const uniqueTexts = new Set<string>();
      let match: RegExpExecArray | null;

      while ((match = textRegex.exec(jsonString)) !== null) {
        const textValue = match[2];
        if (textValue && textValue.length > 1 && !IGNORED_TEXTS.has(textValue)) {
          uniqueTexts.add(textValue);
        }
      }
      adData.texts = Array.from(uniqueTexts);
      continue;
    }

    for (const regex of regexArray) {
      const match = jsonString.match(regex);
      if (match) {
        if (key === "ad_redirect_link") {
          adData.ad_links.ad_redirect_link = match[1];
        } else if (key === "shown_domain") {
          adData.ad_links.shown_domain = match[1];
        } else if (key === "link_title") {
          adData.ad_links.link_title = match[1];
        } else if (key === "external_url") {
          adData.ad_links.external_url = match[1];
        } else if (key === "post_id") {
          adData.post_id = match[1];
        } else if (key === "ad_id") {
          adData.ad_id = match[1];
        } else if (key === "profile_name") {
          adData.profile_name = match[1];
        } else if (key === "profile_id") {
          adData.profile_id = match[1];
        } else if (key === "post_url") {
          adData.post_url = match[1];
        } else if (key === "ad_lib") {
          adData.ad_lib = match[1];
        } else if (key === "ad_button_text") {
          adData.ad_button_text = match[1];
        }
        break;
      }
    }
  }

  if (jsonString.includes("multi_share_media_card_renderer")) {
    const multiShareUrls: string[] = [];
    const multiShareUris: string[] = [];

    const multiShareUrlRegex = /"multi_share_media_card_renderer":\s*{[^}]*"attachment":\s*{[^}]*"url":\s*"([^"]+)"/g;
    const multiShareUriRegex = /"media":\s*{[^}]*"image":\s*{[^}]*"uri":\s*"([^"]+)"/g;

    let urlMatch: RegExpExecArray | null;
    while ((urlMatch = multiShareUrlRegex.exec(jsonString)) !== null) {
      multiShareUrls.push(urlMatch[1]);
    }

    let uriMatch: RegExpExecArray | null;
    while ((uriMatch = multiShareUriRegex.exec(jsonString)) !== null) {
      multiShareUris.push(uriMatch[1]);
    }

    if (multiShareUrls.length > 0) {
      adData.ad_links["sub_links"] = multiShareUrls;
    }
    if (multiShareUris.length > 0) {
      adData.media_links = adData.media_links.concat(multiShareUris);
    }
  }

  await saveAdData(adData);
}

async function saveAdData(data: AdData): Promise<void> {
  if (!data.ad_id) return;
  if (adsProcessedInThisRuntime.has(data.ad_id)) return;
  adsProcessedInThisRuntime.add(data.ad_id);
  await submitAdData(data);

}

async function submitAdData(data: AdData): Promise<boolean> {
  const url = 'https://nimbus.bitdefender.net/ads/malvertising';

  const deviceId = await getDeviceId();
  const dataToSend = deviceId 
    ? { ...data, device_id: deviceId }
    : data;

  try {
    const result = await sendPostRequest(url, dataToSend);
    if (!result) {
      // console.error('Failed to submit data to ads/malvertising.');
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

async function sendPostRequest(
  url: string,
  data: Record<string, any>,
  retries: number = 3,
  retryDelay: number = 1000
): Promise<any | false> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nimbus-ClientID': '93f677ba-caf6-4233-b7eb-2547c442d30c'
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      } else {
        return false;
      }
    }
  }
  return false;
}

async function processSideAdsFeed(sideAds: any[]): Promise<void> {
  if (!sideAds || !Array.isArray(sideAds)) {
    return;
  }

  for (const ad of sideAds) {
    await saveAdData(getSideAdObject(ad));
  }
}