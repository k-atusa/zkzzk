import axios from 'axios';

export function extractChannelId(url: string): string | null {
  const match = url.match(/chzzk\.naver\.com\/([a-f0-9]{32})/);
  return match ? match[1] : null;
}

export async function getChannelInfo(channelId: string): Promise<string | null> {
  try {
    const url = `https://api.chzzk.naver.com/service/v3/channels/${channelId}/live-detail`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Origin': 'https://chzzk.naver.com',
        'Referer': 'https://chzzk.naver.com/'
      }
    });
    if (response.data?.code === 200 && response.data?.content) {
      return response.data.content.channel.channelName;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching channel info:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}
