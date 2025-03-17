#!/usr/bin/env node

import fetch from "node-fetch";
import { Command } from "commander";
import fs from "fs";
import { createObjectCsvWriter } from "csv-writer";
import { parseStringPromise } from "xml2js";

// Initialize CLI
const program = new Command();
program
  .requiredOption("-q, --query <string>", "Search query for PubMed")
  .option("-d, --debug", "Enable debug logging")
  .option("-f, --file <string>", "Filename to save results")
  .parse(process.argv);

const options = program.opts();

const PUBMED_SEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";

const COMPANY_KEYWORDS = ["Pharma", "Biotech", "Therapeutics", "Inc.", "Ltd.", "GmbH", "Corporation", "Research Institute", "Technologies"];

/**
 * Fetch papers from PubMed
 */
async function fetchPubMedPapers(query) {
  const searchUrl = `${PUBMED_SEARCH_URL}?db=pubmed&term=${encodeURIComponent(query)}&retmax=5&retmode=json`;
  if (options.debug) console.log(`Fetching search results from: ${searchUrl}`);

  try {
    const searchResponse = await fetch(searchUrl);
    const searchData = await searchResponse.json();
    const paperIds = searchData?.esearchresult?.idlist || [];

    if (!paperIds.length) {
      console.log("No papers found.");
      return [];
    }

    return fetchPaperDetails(paperIds);
  } catch (error) {
    console.error("Error fetching PubMed search results:", error);
    return [];
  }
}

/**
 * Fetch full paper details using eFetch API
 */
async function fetchPaperDetails(paperIds) {
  const fetchUrl = `${PUBMED_FETCH_URL}?db=pubmed&id=${paperIds.join(",")}&retmode=xml`;
  if (options.debug) console.log(`Fetching paper details from: ${fetchUrl}`);

  try {
    const fetchResponse = await fetch(fetchUrl);
    const xmlData = await fetchResponse.text();
    const jsonData = await parseStringPromise(xmlData);
    
    const articles = jsonData?.PubmedArticleSet?.PubmedArticle || [];
    const papers = [];

    articles.forEach((article) => {
      const articleData = article?.MedlineCitation?.[0]?.Article?.[0];
      const pmid = article?.MedlineCitation?.[0]?.PMID?.[0]?._;
      const title = articleData?.ArticleTitle?.[0] || "No Title";
      const pubDate = article?.MedlineCitation?.[0]?.DateCompleted?.[0]?.Year?.[0] || "Unknown Date";

      const authorList = articleData?.AuthorList?.[0]?.Author || [];
      const affiliations = authorList
        .map((author) => author?.AffiliationInfo?.[0]?.Affiliation?.[0])
        .filter(Boolean); // Remove empty values

      const companyAffiliations = affiliations.filter((aff) =>
        COMPANY_KEYWORDS.some((keyword) => aff.toLowerCase().includes(keyword.toLowerCase()))
      );

      if (companyAffiliations.length) {
        papers.push({
          PubmedID: pmid,
          Title: title,
          PublicationDate: pubDate,
          NonAcademicAuthors: authorList.map((a) => a?.LastName?.[0]).join("; "),
          CompanyAffiliations: companyAffiliations.join("; "),
          CorrespondingAuthorEmail: "N/A", // Not provided by PubMed
        });
      }
    });

    return papers;
  } catch (error) {
    console.error("Error fetching paper details:", error);
    return [];
  }
}

/**
 * Save papers to CSV file
 */
async function saveToCSV(papers, filename) {
  if (!papers.length) {
    console.log("No papers with non-academic affiliations found.");
    return;
  }

  const csvWriter = createObjectCsvWriter({
    path: filename,
    header: [
      { id: "PubmedID", title: "PubmedID" },
      { id: "Title", title: "Title" },
      { id: "PublicationDate", title: "Publication Date" },
      { id: "NonAcademicAuthors", title: "Non-academic Author(s)" },
      { id: "CompanyAffiliations", title: "Company Affiliation(s)" },
      { id: "CorrespondingAuthorEmail", title: "Corresponding Author Email" }
    ]
  });

  await csvWriter.writeRecords(papers);
  console.log(`Results saved to ${filename}`);
}

// Main Execution
(async () => {
  const papers = await fetchPubMedPapers(options.query);

  if (options.file) {
    await saveToCSV(papers, options.file);
  } else {
    console.log(papers);
  }
})();
