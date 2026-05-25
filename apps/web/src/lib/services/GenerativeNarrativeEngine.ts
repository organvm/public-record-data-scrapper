/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
// Experimental generative AI features - disabled strict linting
import type {
  Prospect,
  GenerativeNarrative,
  GenerativeContext,
  GenerativeInsight,
  CompanyGraph,
  CompetitorData,
  GrowthSignal,
  IndustryTrend
} from '@public-records/core'

/**
 * GenerativeNarrativeEngine - AI-powered narrative and insight generation
 * Uses LLM to create personalized, context-aware prospect narratives
 */
export class GenerativeNarrativeEngine {
  private apiEndpoint: string
  private apiKey: string
  private model: string = 'claude-3-5-sonnet-20241022'

  constructor(apiEndpoint?: string, apiKey?: string) {
    this.apiEndpoint =
      apiEndpoint ||
      import.meta.env.VITE_LLM_API_ENDPOINT ||
      'https://api.anthropic.com/v1/messages'
    this.apiKey = apiKey || import.meta.env.VITE_ANTHROPIC_API_KEY || ''
  }

  /**
   * Generate a comprehensive narrative for a prospect
   */
  async generateNarrative(
    context: GenerativeContext,
    userPreferences?: {
      industries?: string[]
      focusAreas?: string[]
      riskTolerance?: 'low' | 'medium' | 'high'
    }
  ): Promise<GenerativeNarrative> {
    const { prospect, marketData, relationships, historicalSignals, industryTrends } = context

    // Build comprehensive prompt
    const prompt = this.buildNarrativePrompt(prospect, {
      marketData,
      relationships: relationships as any,
      historicalSignals: historicalSignals as any,
      industryTrends: industryTrends as any,
      userPreferences
    })

    // Call LLM API
    const response = await this.callLLM(prompt)

    // Parse structured response
    const sections = this.parseNarrativeResponse(response)
    const confidence = this.calculateConfidence(sections)
    const sources = this.extractSources(context)

    const narrative: GenerativeNarrative = {
      prospectId: prospect.id,
      summary: sections.summary || response.substring(0, 500),
      keyInsights: sections.keyFindings.map((text) => ({
        category: 'key_finding',
        text,
        confidence,
        sources
      })),
      riskFactors: sections.riskFactors,
      opportunities: sections.opportunityAnalysis ? [sections.opportunityAnalysis] : [],
      recommendedActions: sections.recommendedActions,
      generatedAt: new Date().toISOString()
    }

    return narrative
  }

  /**
   * Generate actionable insights across multiple prospects
   */
  async generateInsights(
    prospects: Prospect[],
    marketData?: CompetitorData[],
    relationships?: Map<string, CompanyGraph>
  ): Promise<GenerativeInsight[]> {
    const insights: GenerativeInsight[] = []

    // Analyze patterns across prospects
    const patterns = this.analyzePatterns(prospects)

    // Generate opportunity insights
    insights.push(...(await this.generateOpportunityInsights(prospects, patterns)))

    // Generate risk insights
    insights.push(...(await this.generateRiskInsights(prospects, patterns)))

    // Generate trend insights
    insights.push(...(await this.generateTrendInsights(prospects, patterns, marketData)))

    // Generate recommendation insights
    insights.push(...(await this.generateRecommendationInsights(prospects, relationships)))

    return insights.sort((a, b) => {
      const impactWeight = { high: 3, medium: 2, low: 1 }
      return impactWeight[b.impact] * b.confidence - impactWeight[a.impact] * a.confidence
    })
  }

  /**
   * Generate a personalized narrative based on user behavior
   */
  async generatePersonalizedNarrative(
    prospect: Prospect,
    userBehavior: {
      claimedIndustries: string[]
      avgClaimScore: number
      preferredSignals: string[]
    }
  ): Promise<string> {
    const prompt = `
You are an AI assistant helping a commercial lender evaluate prospects.

PROSPECT DETAILS:
- Company: ${prospect.companyName}
- Industry: ${prospect.industry}
- Priority Score: ${prospect.priorityScore}/100
- Health Grade: ${prospect.healthScore.grade}
- Estimated Revenue: $${prospect.estimatedRevenue?.toLocaleString() || 'Unknown'}
- Growth Signals: ${prospect.growthSignals.length} detected
- Time Since Default: ${prospect.timeSinceDefault} days

USER PREFERENCES (learned from behavior):
- Preferred Industries: ${userBehavior.claimedIndustries.join(', ')}
- Average Score of Claims: ${userBehavior.avgClaimScore}
- Preferred Signal Types: ${userBehavior.preferredSignals.join(', ')}

TASK:
Write a personalized 2-3 paragraph narrative explaining why this prospect may be a good fit based on the user's preferences and behavior patterns. Focus on alignment with their historical preferences while being objective about fit.

Format as plain text without markdown.
`

    const response = await this.callLLM(prompt)
    return response.trim()
  }

  /**
   * Build a comprehensive narrative prompt
   */
  private buildNarrativePrompt(
    prospect: Prospect,
    options: {
      marketData?: CompetitorData[]
      relationships?: CompanyGraph
      historicalSignals?: GrowthSignal[]
      industryTrends?: IndustryTrend[]
      userPreferences?: any
    }
  ): string {
    const { marketData, relationships, historicalSignals, industryTrends, userPreferences } =
      options

    let prompt = `
You are an expert commercial lending analyst. Generate a comprehensive prospect analysis.

PROSPECT INFORMATION:
Company Name: ${prospect.companyName}
Industry: ${prospect.industry}
State: ${prospect.state}
Priority Score: ${prospect.priorityScore}/100
Status: ${prospect.status}
Default Date: ${prospect.defaultDate}
Time Since Default: ${prospect.timeSinceDefault} days
Estimated Revenue: $${prospect.estimatedRevenue?.toLocaleString() || 'Unknown'}

HEALTH METRICS:
Grade: ${prospect.healthScore.grade}
Score: ${prospect.healthScore.score}/100
Sentiment Trend: ${prospect.healthScore.sentimentTrend}
Review Count: ${prospect.healthScore.reviewCount}
Violations: ${prospect.healthScore.violationCount}

GROWTH SIGNALS (${prospect.growthSignals.length}):
${prospect.growthSignals.map((s) => `- ${s.type}: ${s.description} (confidence: ${s.confidence})`).join('\n')}

UCC FILINGS (${prospect.uccFilings.length}):
${prospect.uccFilings
  .map(
    (f) => `- ${f.filingDate}: ${f.securedParty} - $${f.lienAmount?.toLocaleString() || 'Unknown'}`
  )
  .join('\n')}
`

    if (relationships) {
      prompt += `\n\nCOMPANY RELATIONSHIPS:
Network Size: ${relationships.totalNodes} companies, ${relationships.totalEdges} connections
Network Health: ${relationships.metadata.networkHealth || 'Unknown'}
Risk Concentration: ${relationships.metadata.riskConcentration?.toFixed(2) || 'Unknown'}
Total Network Exposure: $${relationships.metadata.totalExposure?.toLocaleString() || 'Unknown'}
`
    }

    if (marketData && marketData.length > 0) {
      prompt += `\n\nMARKET CONTEXT:
Top Competitors:
${marketData
  .slice(0, 5)
  .map((c) => `- ${c.lenderName}: ${c.filingCount} deals, $${c.avgDealSize.toLocaleString()} avg`)
  .join('\n')}
`
    }

    if (industryTrends && industryTrends.length > 0) {
      const relevantTrend = industryTrends.find((t) => t.industry === prospect.industry)
      if (relevantTrend) {
        prompt += `\n\nINDUSTRY TRENDS (${prospect.industry}):
Direction: ${relevantTrend.direction}
Growth Rate: ${relevantTrend.growthRate}%
Key Drivers: ${relevantTrend.keyDrivers.join(', ')}
Opportunities: ${relevantTrend.opportunities.join(', ')}
Threats: ${relevantTrend.threats.join(', ')}
`
      }
    }

    if (userPreferences) {
      prompt += `\n\nUSER PREFERENCES:
${JSON.stringify(userPreferences, null, 2)}
`
    }

    prompt += `\n\nTASK:
Generate a comprehensive analysis with the following sections (use exact section headers):

## SUMMARY
[2-3 sentence executive summary]

## KEY_FINDINGS
[Bulleted list of 3-5 most important findings]

## OPPORTUNITY_ANALYSIS
[Detailed paragraph analyzing the opportunity]

## RISK_FACTORS
[Bulleted list of key risks to consider]

## RECOMMENDED_ACTIONS
[Bulleted list of specific next steps]

## MARKET_CONTEXT
[Paragraph on market positioning and competitive landscape]

## COMPETITIVE_LANDSCAPE
[Analysis of competitive dynamics and positioning]

Format as plain text with markdown section headers.
`

    return prompt
  }

  /**
   * Call the configured LLM API.
   */
  private async callLLM(prompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new Error('GenerativeNarrativeEngine requires a live LLM API key')
    }

    const response = await fetch(this.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    })

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const text = data.content?.[0]?.text

    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('LLM API returned an empty narrative payload')
    }

    return text
  }

  /**
   * Parse narrative response into structured sections
   */
  private parseNarrativeResponse(response: string): GenerativeNarrativeSections {
    const sections = {
      summary: '',
      keyFindings: [] as string[],
      opportunityAnalysis: '',
      riskFactors: [] as string[],
      recommendedActions: [] as string[],
      marketContext: '',
      competitiveLandscape: ''
    }

    // Extract sections using regex
    const summaryMatch = response.match(/## SUMMARY\s+([\s\S]*?)(?=##|$)/)
    if (summaryMatch) sections.summary = summaryMatch[1].trim()

    const keyFindingsMatch = response.match(/## KEY_FINDINGS\s+([\s\S]*?)(?=##|$)/)
    if (keyFindingsMatch) {
      sections.keyFindings = keyFindingsMatch[1]
        .split('\n')
        .filter((line) => line.trim().startsWith('-'))
        .map((line) => line.replace(/^-\s*/, '').trim())
    }

    const opportunityMatch = response.match(/## OPPORTUNITY_ANALYSIS\s+([\s\S]*?)(?=##|$)/)
    if (opportunityMatch) sections.opportunityAnalysis = opportunityMatch[1].trim()

    const riskMatch = response.match(/## RISK_FACTORS\s+([\s\S]*?)(?=##|$)/)
    if (riskMatch) {
      sections.riskFactors = riskMatch[1]
        .split('\n')
        .filter((line) => line.trim().startsWith('-'))
        .map((line) => line.replace(/^-\s*/, '').trim())
    }

    const actionsMatch = response.match(/## RECOMMENDED_ACTIONS\s+([\s\S]*?)(?=##|$)/)
    if (actionsMatch) {
      sections.recommendedActions = actionsMatch[1]
        .split('\n')
        .filter((line) => line.trim().startsWith('-'))
        .map((line) => line.replace(/^-\s*/, '').trim())
    }

    const marketMatch = response.match(/## MARKET_CONTEXT\s+([\s\S]*?)(?=##|$)/)
    if (marketMatch) sections.marketContext = marketMatch[1].trim()

    const competitiveMatch = response.match(/## COMPETITIVE_LANDSCAPE\s+([\s\S]*?)(?=##|$)/)
    if (competitiveMatch) sections.competitiveLandscape = competitiveMatch[1].trim()

    return sections
  }

  /**
   * Calculate confidence score based on narrative completeness
   */
  private calculateConfidence(sections: GenerativeNarrative['sections']): number {
    let score = 0
    const weights = {
      summary: 15,
      keyFindings: 20,
      opportunityAnalysis: 20,
      riskFactors: 15,
      recommendedActions: 15,
      marketContext: 10,
      competitiveLandscape: 5
    }

    if (sections.summary.length > 50) score += weights.summary
    if (sections.keyFindings.length >= 3) score += weights.keyFindings
    if (sections.opportunityAnalysis.length > 100) score += weights.opportunityAnalysis
    if (sections.riskFactors.length >= 3) score += weights.riskFactors
    if (sections.recommendedActions.length >= 3) score += weights.recommendedActions
    if (sections.marketContext && sections.marketContext.length > 50) score += weights.marketContext
    if (sections.competitiveLandscape && sections.competitiveLandscape.length > 50)
      score += weights.competitiveLandscape

    return score / 100
  }

  /**
   * Extract sources from context
   */
  private extractSources(context: GenerativeContext): string[] {
    const sources: string[] = []

    if (context.prospect.uccFilings.length > 0) {
      sources.push('UCC Filings')
    }

    if (context.prospect.growthSignals.length > 0) {
      sources.push('Growth Signals')
      context.prospect.growthSignals.forEach((signal) => {
        if (signal.sourceUrl) sources.push(signal.sourceUrl)
      })
    }

    if (context.marketData && context.marketData.length > 0) {
      sources.push('Market Data')
    }

    if (context.relationships) {
      sources.push('Relationship Graph')
    }

    if (context.industryTrends) {
      sources.push('Industry Trends')
    }

    return [...new Set(sources)]
  }

  /**
   * Analyze patterns across prospects
   */
  private analyzePatterns(prospects: Prospect[]): {
    industryDistribution: Map<string, number>
    avgScoreByIndustry: Map<string, number>
    signalCorrelations: Map<string, string[]>
    healthTrends: Map<string, number>
  } {
    const industryDistribution = new Map<string, number>()
    const avgScoreByIndustry = new Map<string, number>()
    const healthTrends = new Map<string, number>()
    const signalCorrelations = new Map<string, string[]>()

    // Calculate industry distribution
    for (const prospect of prospects) {
      industryDistribution.set(
        prospect.industry,
        (industryDistribution.get(prospect.industry) || 0) + 1
      )

      // Track scores by industry
      const currentAvg = avgScoreByIndustry.get(prospect.industry) || 0
      const count = industryDistribution.get(prospect.industry) || 1
      avgScoreByIndustry.set(
        prospect.industry,
        (currentAvg * (count - 1) + prospect.priorityScore) / count
      )

      // Track health trends
      healthTrends.set(
        prospect.healthScore.sentimentTrend,
        (healthTrends.get(prospect.healthScore.sentimentTrend) || 0) + 1
      )

      // Track signal correlations
      for (const signal of prospect.growthSignals) {
        const otherSignals = prospect.growthSignals
          .filter((s) => s.id !== signal.id)
          .map((s) => s.type)
        signalCorrelations.set(signal.type, [
          ...(signalCorrelations.get(signal.type) || []),
          ...otherSignals
        ])
      }
    }

    return {
      industryDistribution,
      avgScoreByIndustry,
      signalCorrelations,
      healthTrends
    }
  }

  /**
   * Generate opportunity insights
   */
  private async generateOpportunityInsights(
    prospects: Prospect[],
    patterns: ReturnType<typeof this.analyzePatterns>
  ): Promise<GenerativeInsight[]> {
    const insights: GenerativeInsight[] = []

    // High-growth industry insight
    const topIndustry = [...patterns.avgScoreByIndustry.entries()].sort((a, b) => b[1] - a[1])[0]

    if (topIndustry) {
      const [industry, avgScore] = topIndustry
      const relatedProspects = prospects.filter((p) => p.industry === industry).map((p) => p.id)

      insights.push({
        id: `insight-opportunity-${Date.now()}-1`,
        type: 'opportunity',
        title: `High-Performing ${industry.charAt(0).toUpperCase() + industry.slice(1)} Sector`,
        description: `The ${industry} sector shows strong performance with an average priority score of ${avgScore.toFixed(1)}. ${relatedProspects.length} prospects in this industry may warrant prioritized review.`,
        confidence: 0.85,
        impact: 'high',
        relatedProspects,
        generatedAt: new Date().toISOString(),
        evidence: [
          `Average score: ${avgScore.toFixed(1)}`,
          `Prospect count: ${relatedProspects.length}`,
          `Industry distribution analysis`
        ]
      })
    }

    // Signal cluster insight
    const prospectsWithMultipleSignals = prospects.filter((p) => p.growthSignals.length >= 3)
    if (prospectsWithMultipleSignals.length > 0) {
      insights.push({
        id: `insight-opportunity-${Date.now()}-2`,
        type: 'opportunity',
        title: 'Strong Signal Clusters Detected',
        description: `${prospectsWithMultipleSignals.length} prospects show multiple concurrent growth signals, indicating high-confidence opportunities.`,
        confidence: 0.9,
        impact: 'high',
        relatedProspects: prospectsWithMultipleSignals.map((p) => p.id),
        generatedAt: new Date().toISOString(),
        evidence: [
          `Prospects with 3+ signals: ${prospectsWithMultipleSignals.length}`,
          `Signal correlation analysis`
        ]
      })
    }

    return insights
  }

  /**
   * Generate risk insights
   */
  private async generateRiskInsights(
    prospects: Prospect[],
    patterns: ReturnType<typeof this.analyzePatterns>
  ): Promise<GenerativeInsight[]> {
    const insights: GenerativeInsight[] = []

    // Declining health trend
    const decliningCount = patterns.healthTrends.get('declining') || 0
    const totalCount = prospects.length

    if (decliningCount / totalCount > 0.3) {
      const decliningProspects = prospects
        .filter((p) => p.healthScore.sentimentTrend === 'declining')
        .map((p) => p.id)

      insights.push({
        id: `insight-risk-${Date.now()}-1`,
        type: 'risk',
        title: 'Elevated Health Decline Risk',
        description: `${decliningCount} prospects (${((decliningCount / totalCount) * 100).toFixed(1)}%) show declining health trends, requiring immediate attention.`,
        confidence: 0.8,
        impact: 'high',
        relatedProspects: decliningProspects,
        generatedAt: new Date().toISOString(),
        evidence: [
          `Declining prospects: ${decliningCount}`,
          `Percentage: ${((decliningCount / totalCount) * 100).toFixed(1)}%`
        ]
      })
    }

    return insights
  }

  /**
   * Generate trend insights
   */
  private async generateTrendInsights(
    prospects: Prospect[],
    patterns: ReturnType<typeof this.analyzePatterns>,
    marketData?: CompetitorData[]
  ): Promise<GenerativeInsight[]> {
    const insights: GenerativeInsight[] = []

    // Industry concentration trend
    const topIndustries = [...patterns.industryDistribution.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)

    if (topIndustries.length > 0) {
      const totalProspects = prospects.length
      const topThreeCount = topIndustries.reduce((sum, [, count]) => sum + count, 0)
      const concentration = (topThreeCount / totalProspects) * 100

      insights.push({
        id: `insight-trend-${Date.now()}-1`,
        type: 'trend',
        title: 'Industry Concentration Pattern',
        description: `Top 3 industries (${topIndustries.map(([ind]) => ind).join(', ')}) represent ${concentration.toFixed(1)}% of prospects, indicating ${concentration > 60 ? 'high' : 'moderate'} concentration.`,
        confidence: 0.75,
        impact: concentration > 60 ? 'high' : 'medium',
        relatedProspects: prospects
          .filter((p) => topIndustries.some(([ind]) => ind === p.industry))
          .map((p) => p.id),
        generatedAt: new Date().toISOString(),
        evidence: [
          `Top industries: ${topIndustries.map(([ind, count]) => `${ind} (${count})`).join(', ')}`,
          `Concentration: ${concentration.toFixed(1)}%`
        ]
      })
    }

    return insights
  }

  /**
   * Generate recommendation insights
   */
  private async generateRecommendationInsights(
    prospects: Prospect[],
    relationships?: Map<string, CompanyGraph>
  ): Promise<GenerativeInsight[]> {
    const insights: GenerativeInsight[] = []

    // High-priority unclaimed prospects
    const unclaimedHighPriority = prospects.filter((p) => !p.claimedBy && p.priorityScore >= 75)

    if (unclaimedHighPriority.length > 0) {
      insights.push({
        id: `insight-recommendation-${Date.now()}-1`,
        type: 'recommendation',
        title: 'Unclaimed High-Priority Prospects',
        description: `${unclaimedHighPriority.length} high-priority prospects (score ≥75) remain unclaimed and should be reviewed immediately.`,
        confidence: 0.95,
        impact: 'high',
        relatedProspects: unclaimedHighPriority.map((p) => p.id),
        generatedAt: new Date().toISOString(),
        evidence: [
          `Unclaimed prospects: ${unclaimedHighPriority.length}`,
          `Priority threshold: 75`,
          `Average score: ${(unclaimedHighPriority.reduce((sum, p) => sum + p.priorityScore, 0) / unclaimedHighPriority.length).toFixed(1)}`
        ]
      })
    }

    return insights
  }
}
