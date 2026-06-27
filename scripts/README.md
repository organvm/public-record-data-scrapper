# scripts

## Description

This directory contains utility scripts for database management, background tasks, and the CLI scraper interface for the `public-record-data-scrapper` project.

## Installation

Run standard initialization at the project root to install dependencies:

```bash
npm install --legacy-peer-deps
```

## Usage

### CLI Scraper

The `npm run scrape` command wraps `scripts/cli-scraper.ts` to expose several scraper-related utilities. You can see command-level help with `npm run scrape -- --help`.

#### Scrape a single UCC filing

```bash
npm run scrape -- scrape-ucc -c "Company Name" -s CA -o ./results.json
#   required: -c|--company <name>, -s|--state <code>
#   optional: -o|--output <file> (default: ./output.json), --csv
#   supported states: CA, TX, FL, NY
```

#### Enrich company data

```bash
npm run scrape -- enrich -c "Company Name" -s CA --tier professional -o ./enriched-data.json
#   required: -c|--company <name>, -s|--state <code>
#   optional: -o|--output <file> (default: ./enriched-data.json), --tier <free|starter|professional>, --csv
```

#### Normalize a company name

```bash
npm run scrape -- normalize -n "Company Name"
#   required: -n|--name <name>
```

#### Batch process companies

```bash
npm run scrape -- batch -i ./companies.csv -o ./batch-results
#   required: -i|--input <file> (CSV header + rows company,state)
#   optional: -o|--output <dir> (default: ./batch-results), --enrich
```

#### Export leads

```bash
npm run scrape -- lead-export --min-score 70 --max-score 95 --state CA --limit 100 --offset 0 --output-dir ./lead-export
#   optional: -o|--output-dir <dir> (default: ./lead-export)
#   optional: --format <json|csv|both> (default: both)
#   optional: --min-score <0-100> (default: 70), --max-score <0-100>
#   optional: --state <CA|TX|FL|NY>, --industry <name>, --status <status>
#   optional: --limit <1-1000> (default: 100), --offset <integer> (default: 0)
```

#### List available states

```bash
npm run scrape -- list-states
```

### Other Key Scripts

*   `npm run scrape:scheduled` (`tsx scripts/scheduled-run.ts`) - Executes the scheduled scraper workflow.
*   `npm run db:migrate` (`tsx scripts/migrate.ts`) - Applies database migrations.
*   `npm run seed` (`tsx scripts/seed-database.ts`) - Seeds the database with initial data.
*   `npm run train:ml-model` (`tsx scripts/trainMLModel.ts`) - Trains the experimental ML scoring model.

## Subdirectories

*   `scrapers/`: Contains real Puppeteer-based UCC filing scrapers for various states (e.g. California, Texas, Florida, New York). See `scrapers/README.md` for more details.
*   `video-production/`: Contains scripts for video generation and validation (`video:generate`, `video:validate`).
*   `academic/`, `audience/`: Miscellaneous scripts for specialized tasks.
