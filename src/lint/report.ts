// src/lint/report.ts -- Report formatter (error/warning/suggestion categories)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single finding from a lint check.
 */
export interface LintFinding {
  severity: 'error' | 'warning' | 'suggestion';
  category:
    | 'BROKEN_LINK'
    | 'ORPHAN'
    | 'STALE_SOURCE'
    | 'MISSING_FRONTMATTER'
    | 'CONTRADICTION'
    | 'MISSING_LINK';
  page: string;
  message: string;
  details?: string;
  autoFixable: boolean;
}

/**
 * Structured lint report with categorized findings and summary counts.
 */
export interface LintReport {
  generatedAt: string;
  errors: LintFinding[];
  warnings: LintFinding[];
  suggestions: LintFinding[];
  summary: {
    totalErrors: number;
    totalWarnings: number;
    totalSuggestions: number;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Partition findings by severity and produce a structured LintReport.
 */
export function generateReport(findings: LintFinding[]): LintReport {
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  const suggestions = findings.filter((f) => f.severity === 'suggestion');

  return {
    generatedAt: new Date().toISOString(),
    errors,
    warnings,
    suggestions,
    summary: {
      totalErrors: errors.length,
      totalWarnings: warnings.length,
      totalSuggestions: suggestions.length,
    },
  };
}

/**
 * Format a LintReport as a categorized markdown string.
 * Suitable for writing to wiki/lint-report.md.
 */
export function formatReport(findings: LintFinding[]): string {
  const report = generateReport(findings);
  return formatReportAsMarkdown(report);
}

/**
 * Format a structured LintReport as markdown.
 */
export function formatReportAsMarkdown(report: LintReport): string {
  const lines: string[] = [];
  const dateStr = new Date(report.generatedAt).toISOString().replace('T', ' ').slice(0, 16);

  lines.push('# Wiki Lint Report');
  lines.push(`Generated: ${dateStr}`);
  lines.push('');

  // Errors
  lines.push(`## Errors (${report.summary.totalErrors})`);
  if (report.errors.length === 0) {
    lines.push('No errors found.');
  } else {
    for (const f of report.errors) {
      lines.push(`- [${f.category}] ${f.message}`);
      if (f.details) {
        lines.push(`  > ${f.details}`);
      }
    }
  }
  lines.push('');

  // Warnings
  lines.push(`## Warnings (${report.summary.totalWarnings})`);
  if (report.warnings.length === 0) {
    lines.push('No warnings found.');
  } else {
    for (const f of report.warnings) {
      lines.push(`- [${f.category}] ${f.message}`);
      if (f.details) {
        lines.push(`  > ${f.details}`);
      }
    }
  }
  lines.push('');

  // Suggestions
  lines.push(`## Suggestions (${report.summary.totalSuggestions})`);
  if (report.suggestions.length === 0) {
    lines.push('No suggestions.');
  } else {
    for (const f of report.suggestions) {
      lines.push(`- [${f.category}] ${f.message}`);
      if (f.details) {
        lines.push(`  > ${f.details}`);
      }
    }
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Format a structured LintReport for console output with simple text formatting.
 */
export function formatReportForConsole(report: LintReport): string {
  const lines: string[] = [];
  const total =
    report.summary.totalErrors +
    report.summary.totalWarnings +
    report.summary.totalSuggestions;

  lines.push(`Lint: ${total} finding(s) -- ` +
    `${report.summary.totalErrors} error(s), ` +
    `${report.summary.totalWarnings} warning(s), ` +
    `${report.summary.totalSuggestions} suggestion(s)`);
  lines.push('');

  if (report.errors.length > 0) {
    lines.push('Errors:');
    for (const f of report.errors) {
      lines.push(`  [${f.category}] ${f.message}`);
    }
    lines.push('');
  }

  if (report.warnings.length > 0) {
    lines.push('Warnings:');
    for (const f of report.warnings) {
      lines.push(`  [${f.category}] ${f.message}`);
    }
    lines.push('');
  }

  if (report.suggestions.length > 0) {
    lines.push('Suggestions:');
    for (const f of report.suggestions) {
      lines.push(`  [${f.category}] ${f.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
