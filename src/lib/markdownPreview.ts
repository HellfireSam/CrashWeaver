import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import katex from 'katex';

const LOCAL_RESOURCE_PATTERN = /^(?![a-z][a-z\d+.-]*:|\/\/|#)(.+)$/i;
const UNSAFE_ELEMENT_SELECTORS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'meta',
  'link',
  'style',
  'base',
].join(', ');
const SAFE_URL_PROTOCOLS = new Set(['http', 'https', 'mailto', 'tel', 'crashweaver-local']);

const markdown = new MarkdownIt({ html: true, linkify: true, breaks: true }).use(texmath, {
  engine: katex,
  delimiters: ['dollars', 'brackets'],
  katexOptions: {
    throwOnError: false,
    strict: 'ignore',
  },
});

function splitResourceSuffix(resourcePath: string) {
  const match = resourcePath.match(/^([^?#]*)([?#].*)?$/);
  return {
    path: match?.[1] ?? resourcePath,
    suffix: match?.[2] ?? '',
  };
}

function normalizeFileSystemPath(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

function stripLocalPrefix(value: string) {
  return value.replace(/^\.\//, '').replace(/^\/+/, '');
}

function joinFilePath(rootPath: string, relativePath: string) {
  return `${normalizeFileSystemPath(rootPath)}/${relativePath.replace(/^\/+/, '')}`;
}

function getDirectoryLabels(directoryPath: string, vaultRoot?: string | null) {
  const normalizedDirectory = normalizeFileSystemPath(directoryPath);
  const labels = new Set<string>();
  const parts = normalizedDirectory.split('/').filter(Boolean);
  const baseName = parts[parts.length - 1];

  if (baseName) {
    labels.add(baseName);
  }

  if (vaultRoot) {
    const normalizedVault = normalizeFileSystemPath(vaultRoot);

    if (normalizedDirectory.toLowerCase().startsWith(`${normalizedVault.toLowerCase()}/`)) {
      labels.add(normalizedDirectory.slice(normalizedVault.length + 1));
    }
  }

  return [...labels].sort((left, right) => right.length - left.length);
}

function splitSuffix(suffix: string) {
  const queryMatch = suffix.match(/^\?([^#]*)(#.*)?$/);

  if (queryMatch) {
    return {
      query: queryMatch[1] ?? '',
      hash: queryMatch[2] ?? '',
    };
  }

  return {
    query: '',
    hash: suffix.startsWith('#') ? suffix : '',
  };
}

function toLocalAssetUrl(absolutePath: string, suffix: string) {
  const decodedPath = (() => {
    try {
      return decodeURI(absolutePath);
    } catch {
      return absolutePath;
    }
  })();

  const { query, hash } = splitSuffix(suffix);
  const url = new URL('crashweaver-local://asset');
  url.searchParams.set('path', decodedPath);

  if (query) {
    url.searchParams.set('resourceQuery', query);
  }

  if (hash) {
    url.hash = hash;
  }

  return url.toString();
}

function toVaultFileUrl(
  resourcePath: string,
  vaultRoot: string,
  imageDirectories: string[] = [],
  attribute: 'src' | 'href' = 'src',
) {
  if (!LOCAL_RESOURCE_PATTERN.test(resourcePath)) {
    return null;
  }

  const { path, suffix } = splitResourceSuffix(resourcePath.trim());
  const normalizedPath = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const strippedPath = stripLocalPrefix(normalizedPath);

  if (!strippedPath || strippedPath.startsWith('../')) {
    return null;
  }

  if (!normalizedPath.startsWith('/') && attribute === 'src' && imageDirectories.length > 0) {
    for (const imageDirectory of imageDirectories) {
      const labels = getDirectoryLabels(imageDirectory, vaultRoot);

      for (const label of labels) {
        if (strippedPath !== label && !strippedPath.startsWith(`${label}/`)) {
          continue;
        }

        const relativePath = strippedPath === label ? '' : strippedPath.slice(label.length + 1);
        return toLocalAssetUrl(
          relativePath ? joinFilePath(imageDirectory, relativePath) : normalizeFileSystemPath(imageDirectory),
          suffix,
        );
      }
    }

    return toLocalAssetUrl(joinFilePath(imageDirectories[0], strippedPath), suffix);
  }

  return toLocalAssetUrl(joinFilePath(vaultRoot, strippedPath), suffix);
}

function sanitizeUrlValue(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('#')) {
    return trimmed;
  }

  if (trimmed.startsWith('//')) {
    return null;
  }

  const protocolMatch = trimmed.match(/^([a-z][a-z\d+.-]*):/i);

  if (!protocolMatch) {
    return trimmed;
  }

  const protocol = protocolMatch[1].toLowerCase();
  return SAFE_URL_PROTOCOLS.has(protocol) ? trimmed : null;
}

function sanitizeAndRewriteRenderedHtml(rendered: string, vaultRoot?: string | null, imageDirectories: string[] = []) {
  const parser = new DOMParser();
  const document = parser.parseFromString(rendered, 'text/html');

  document.querySelectorAll(UNSAFE_ELEMENT_SELECTORS).forEach((element) => {
    element.remove();
  });

  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const attributeName = attribute.name.toLowerCase();

      if (attributeName.startsWith('on') || attributeName === 'srcdoc') {
        element.removeAttribute(attribute.name);
      }
    }
  }

  for (const element of document.querySelectorAll('[src], [href]')) {
    const source = element.getAttribute('src');

    if (source !== null) {
      const rewritten =
        vaultRoot != null ? toVaultFileUrl(source, vaultRoot, imageDirectories, 'src') ?? source : source;
      const safeValue = sanitizeUrlValue(rewritten);

      if (safeValue) {
        element.setAttribute('src', safeValue);
      } else {
        element.removeAttribute('src');
      }
    }

    const href = element.getAttribute('href');

    if (href !== null) {
      const rewritten = vaultRoot != null ? toVaultFileUrl(href, vaultRoot, [], 'href') ?? href : href;
      const safeValue = sanitizeUrlValue(rewritten);

      if (safeValue) {
        element.setAttribute('href', safeValue);
      } else {
        element.removeAttribute('href');
      }
    }
  }

  return document.body.innerHTML;
}

export function renderMarkdownPreview(content: string, vaultRoot?: string | null, imageDirectories: string[] = []): string {
  const rendered = markdown.render(content);
  return sanitizeAndRewriteRenderedHtml(rendered, vaultRoot, imageDirectories);
}
