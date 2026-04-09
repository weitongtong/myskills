#!/usr/bin/env node
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

function stripNoise(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function extractTitle(html) {
  const ogTitle = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
  if (ogTitle) return ogTitle[1].trim();

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleTag) return titleTag[1].replace(/<[^>]+>/g, '').trim();

  return '';
}

function htmlToText(html) {
  let text = stripNoise(html);

  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, _l, c) => `\n\n${c.replace(/<[^>]+>/g, '').trim()}\n\n`);
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `\n- ${c.replace(/<[^>]+>/g, '').trim()}`);
  text = text.replace(/<\/(p|div|section|article)>/gi, '\n\n');
  text = text.replace(/<(br|hr)\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');

  text = text.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function output(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    output({ status: 'error', message: '用法: node fetch-content.mjs <URL>' });
    process.exit(1);
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      output({ status: 'error', message: `HTTP ${res.status} ${res.statusText}`, url });
      process.exit(2);
    }

    const html = await res.text();
    const title = extractTitle(html);
    const text = htmlToText(html);

    if (text.length < 50) {
      output({ status: 'error', message: '提取到的内容过短，可能需要登录或页面为动态渲染', url });
      process.exit(2);
    }

    output({ status: 'ok', url, title, length: text.length, text });
  } catch (e) {
    output({ status: 'error', message: e.message, url });
    process.exit(2);
  }
}

main();
