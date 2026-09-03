"use client";

import { useState } from "react";
import SearchBar from "./searchbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface LinkResult {
  url: string;
  status: number;
  sourcePage: string;
  category: "broken" | "redirect" | "ok" | "unchecked";
}

const ASSET_EXTENSIONS = new Set([
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".css", ".js", ".mjs",
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico",
  ".mp4", ".mp3", ".webm",
  ".pdf", ".zip", ".tar", ".gz",
  ".xml", ".json",
]);

function isAssetUrl(href: string): boolean {
  try {
    const pathname = new URL(href, "https://x").pathname.toLowerCase();
    return ASSET_EXTENSIONS.has(
      pathname.slice(pathname.lastIndexOf("."))
    );
  } catch {
    return false;
  }
}

function extractLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const regex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const href = match[1];
    if (isAssetUrl(href)) continue;
    if (href.startsWith("http://") || href.startsWith("https://")) {
      links.push(href);
    } else if (href.startsWith("/")) {
      try {
        const base = new URL(baseUrl);
        links.push(`${base.origin}${href}`);
      } catch {}
    }
  }
  return [...new Set(links)];
}

type Filter = "all" | "broken" | "redirect" | "ok" | "unchecked";
type ExportFormat = "json" | "csv" | "markdown";

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportLinks(links: LinkResult[], healthScore: number, pagesCount: number, format: ExportFormat) {
  const ts = new Date().toISOString().slice(0, 10);
  const broken = links.filter((l) => l.category === "broken");
  const redirects = links.filter((l) => l.category === "redirect");
  const ok = links.filter((l) => l.category === "ok");
  const unchecked = links.filter((l) => l.category === "unchecked");

  if (format === "json") {
    const report = {
      date: ts,
      healthScore,
      pagesScanned: pagesCount,
      summary: { total: links.length, broken: broken.length, redirects: redirects.length, ok: ok.length, unchecked: unchecked.length },
      links,
    };
    downloadBlob(JSON.stringify(report, null, 2), `dead-link-report-${ts}.json`, "application/json");
  } else if (format === "csv") {
    const rows = [["Link URL", "Status", "Category", "Found On"]];
    for (const l of links) {
      rows.push([l.url, l.category === "unchecked" ? "N/A" : String(l.status), l.category, l.sourcePage]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadBlob(csv, `dead-link-report-${ts}.csv`, "text/csv");
  } else {
    let md = `# Dead Link Report\n\n**Date:** ${ts}\n**Pages Scanned:** ${pagesCount}\n**Link Health:** ${healthScore}%\n\n`;
    md += `| Metric | Count |\n|--------|-------|\n`;
    md += `| Total Links | ${links.length} |\n`;
    md += `| Broken | ${broken.length} |\n`;
    md += `| Redirects | ${redirects.length} |\n`;
    md += `| OK | ${ok.length} |\n`;
    md += `| Not Crawled | ${unchecked.length} |\n\n`;
    if (broken.length > 0) {
      md += `## Broken Links\n\n| URL | Status | Found On |\n|-----|--------|----------|\n`;
      for (const l of broken) md += `| ${l.url} | ${l.status} | ${l.sourcePage} |\n`;
      md += "\n";
    }
    if (redirects.length > 0) {
      md += `## Redirects\n\n| URL | Status | Found On |\n|-----|--------|----------|\n`;
      for (const l of redirects) md += `| ${l.url} | ${l.status} | ${l.sourcePage} |\n`;
      md += "\n";
    }
    if (unchecked.length > 0) {
      md += `## Not Crawled (External)\n\n| URL | Found On |\n|-----|----------|\n`;
      for (const l of unchecked) md += `| ${l.url} | ${l.sourcePage} |\n`;
      md += "\n";
    }
    downloadBlob(md, `dead-link-report-${ts}.md`, "text/markdown");
  }
}

type SortKey = "url" | "status" | "sourcePage";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`inline-block ml-1 text-[10px] ${active ? "text-[#3bde77]" : "text-muted-foreground/40"}`}>
      {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
    </span>
  );
}

export default function Checker() {
  const [data, setData] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const pages = data || [];
  const crawledUrls = new Set(pages.map((p: any) => p?.url).filter(Boolean));
  const allLinks: LinkResult[] = [];

  for (const page of pages) {
    if (!page?.url || !page?.content) continue;
    const found = extractLinks(page.content, page.url);
    for (const link of found) {
      const linkedPage = pages.find((p: any) => p.url === link);
      const status = linkedPage?.status || (linkedPage ? 200 : 0);
      let category: LinkResult["category"];
      if (!crawledUrls.has(link)) {
        category = "unchecked";
      } else if (status >= 400) {
        category = "broken";
      } else if (status >= 300) {
        category = "redirect";
      } else {
        category = "ok";
      }
      allLinks.push({ url: link, status, sourcePage: page.url, category });
    }
  }

  const broken = allLinks.filter((l) => l.category === "broken");
  const redirects = allLinks.filter((l) => l.category === "redirect");
  const okLinks = allLinks.filter((l) => l.category === "ok");
  const unchecked = allLinks.filter((l) => l.category === "unchecked");

  const filteredUnsorted = filter === "all" ? allLinks : allLinks.filter((l) => l.category === filter);
  const filtered = [...filteredUnsorted].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "url") cmp = a.url.localeCompare(b.url);
    else if (sortKey === "status") cmp = a.status - b.status;
    else cmp = a.sourcePage.localeCompare(b.sourcePage);
    return sortDir === "asc" ? cmp : -cmp;
  });
  const healthScore = allLinks.length > 0
    ? Math.round(((okLinks.length + redirects.length) / Math.max(1, allLinks.length - unchecked.length)) * 100)
    : 0;

  function badgeVariant(cat: LinkResult["category"]): "destructive" | "secondary" | "default" | "outline" {
    switch (cat) {
      case "broken": return "destructive";
      case "redirect": return "secondary";
      case "ok": return "default";
      case "unchecked": return "outline";
    }
  }

  function statusLabel(link: LinkResult): string {
    if (link.category === "unchecked") return "Not Crawled";
    return String(link.status);
  }

  function scoreColor(score: number): string {
    if (score >= 90) return "text-green-400";
    if (score >= 70) return "text-yellow-400";
    if (score >= 50) return "text-orange-400";
    return "text-red-400";
  }

  function scoreBg(score: number): string {
    if (score >= 90) return "bg-green-500/10 border-green-500/20";
    if (score >= 70) return "bg-yellow-500/10 border-yellow-500/20";
    if (score >= 50) return "bg-orange-500/10 border-orange-500/20";
    return "bg-red-500/10 border-red-500/20";
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SearchBar setDataValues={setData} />
      <div className="flex-1 overflow-auto p-4 max-w-6xl mx-auto w-full">
        {pages.length > 0 ? (
          <>
            {/* Health Score + Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <div className={`border rounded-lg p-4 text-center ${scoreBg(healthScore)}`}>
                <p className={`text-3xl font-bold ${scoreColor(healthScore)}`}>{healthScore}%</p>
                <p className="text-xs text-muted-foreground mt-1">Link Health</p>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <p className="text-2xl font-bold">{pages.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Pages Crawled</p>
              </div>
              <div className="border rounded-lg p-4 text-center">
                <p className="text-2xl font-bold">{allLinks.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Total Links</p>
              </div>
              <div className="border rounded-lg p-4 text-center bg-red-500/10 border-red-500/20">
                <p className="text-2xl font-bold text-red-400">{broken.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Broken</p>
              </div>
              <div className="border rounded-lg p-4 text-center bg-yellow-500/10 border-yellow-500/20">
                <p className="text-2xl font-bold text-yellow-400">{redirects.length}</p>
                <p className="text-xs text-muted-foreground mt-1">Redirects</p>
              </div>
              <div className="border rounded-lg p-4 text-center bg-green-500/10 border-green-500/20">
                <p className="text-2xl font-bold text-green-400">{okLinks.length}</p>
                <p className="text-xs text-muted-foreground mt-1">OK</p>
              </div>
            </div>

            {/* Success / Warning Banner */}
            {broken.length === 0 ? (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 mb-6 text-center">
                <p className="text-green-400 font-semibold text-lg">No broken links found!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  All {okLinks.length + redirects.length} checked links are healthy across {pages.length} pages.
                  {unchecked.length > 0 && ` ${unchecked.length} external links were not crawled.`}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 mb-6 text-center">
                <p className="text-red-400 font-semibold text-lg">
                  {broken.length} broken link{broken.length !== 1 ? "s" : ""} found
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Review the broken links below and fix them on your website.
                </p>
              </div>
            )}

            {/* Download Controls */}
            <div className="flex items-center gap-2 mb-4">
              <Select value={exportFormat} onValueChange={(v) => setExportFormat(v as ExportFormat)}>
                <SelectTrigger className="w-[130px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">JSON</SelectItem>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="markdown">Markdown</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => exportLinks(allLinks, healthScore, pages.length, exportFormat)}>
                Download All ({allLinks.length})
              </Button>
              {filter !== "all" && filtered.length > 0 && (
                <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => exportLinks(filtered, healthScore, pages.length, exportFormat)}>
                  Download Filtered ({filtered.length})
                </Button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {([
                ["all", `All (${allLinks.length})`],
                ["broken", `Broken (${broken.length})`],
                ["redirect", `Redirects (${redirects.length})`],
                ["ok", `OK (${okLinks.length})`],
                ["unchecked", `Not Crawled (${unchecked.length})`],
              ] as [Filter, string][]).map(([key, label]) => (
                <Button
                  key={key}
                  size="sm"
                  variant={filter === key ? "default" : "outline"}
                  onClick={() => setFilter(key)}
                  className="text-xs"
                >
                  {label}
                </Button>
              ))}
            </div>

            {/* Links Table */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium cursor-pointer hover:text-foreground transition-colors select-none" onClick={() => toggleSort("url")}>
                      Link URL<SortIcon active={sortKey === "url"} dir={sortDir} />
                    </th>
                    <th className="text-center p-3 font-medium w-28 cursor-pointer hover:text-foreground transition-colors select-none" onClick={() => toggleSort("status")}>
                      Status<SortIcon active={sortKey === "status"} dir={sortDir} />
                    </th>
                    <th className="text-left p-3 font-medium cursor-pointer hover:text-foreground transition-colors select-none" onClick={() => toggleSort("sourcePage")}>
                      Found On<SortIcon active={sortKey === "sourcePage"} dir={sortDir} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="p-8 text-center text-muted-foreground">
                        No links match the current filter.
                      </td>
                    </tr>
                  ) : (
                    filtered.slice(0, 500).map((link, i) => (
                      <tr key={`${link.url}-${link.sourcePage}-${i}`} className="border-t hover:bg-muted/30 transition-colors">
                        <td className="p-3 truncate max-w-sm" title={link.url}>
                          <a href={link.url} target="_blank" rel="noreferrer" className="font-mono text-xs hover:text-primary hover:underline">
                            {link.url}
                          </a>
                        </td>
                        <td className="p-3 text-center">
                          <Badge variant={badgeVariant(link.category)}>
                            {statusLabel(link)}
                          </Badge>
                        </td>
                        <td className="p-3 truncate max-w-xs text-muted-foreground text-xs" title={link.sourcePage}>
                          {link.sourcePage}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {filtered.length > 500 && (
                <div className="p-3 text-center text-xs text-muted-foreground border-t">
                  Showing 500 of {filtered.length} links
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
            <svg
              height={64}
              width={64}
              viewBox="0 0 24 24"
              xmlSpace="preserve"
              xmlns="http://www.w3.org/2000/svg"
              className="fill-[#3bde77] opacity-30 animate-spider-pulse"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M20.646 5.196A2.25 2.25 0 0 0 17.199 2.304L15.447 4.391A4.5 4.5 0 0 1 8.553 4.391L6.801 2.304A2.25 2.25 0 0 0 3.354 5.196L8.697 11.564A4.5 4.5 0 0 1 9.75 14.457L9.75 20.25A2.25 2.25 0 0 0 14.25 20.25L14.25 14.457A4.5 4.5 0 0 1 15.303 11.564L20.646 5.196Z"
              ></path>
            </svg>
            <h2 className="text-xl font-semibold text-muted-foreground">
              Spider Dead Link Checker
            </h2>
            <p className="text-sm text-muted-foreground max-w-md">
              Enter a website URL above to crawl and check for broken links.
              Spider will find all links on each page and verify their status.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
