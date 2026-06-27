/* eslint-disable @typescript-eslint/no-unused-vars */
// Experimental personalization features - disabled strict linting

/**
 * Personalization Engine - Behavioral tracking and personalized recommendations
 * Learns from user behavior to provide tailored experiences
 */

import type {
  UserProfile,
  UserPreferences,
  UserBehavior,
  UserAction,
  UserPerformance,
  UserSegment,
  PersonalizedProspect,
  PersonalizedDashboard,
  PersonalizedRecommendation,
  RecommendationContext,
  PersonalizationModel,
  PersonalizedWidget,
  PersonalizedInsight,
  LearnedPreference,
  TimingModel,
  ChannelModel,
  QuickAction,
  ActivityItem,
  ChannelMetrics
} from '@/types/personalization'
import type { OutreachChannel } from '@/types/generative'
import type { Prospect } from '@public-records/core'

export class PersonalizationEngine {
  private profiles: Map<string, UserProfile> = new Map()
  private behaviorQueue: Map<string, UserAction[]> = new Map()

  /**
   * Get user profile
   */
  async getUserProfile(userId: string): Promise<UserProfile> {
    let profile = this.profiles.get(userId)

    if (!profile) {
      profile = this.createDefaultProfile(userId)
      this.profiles.set(userId, profile)
    }

    return profile
  }

  /**
   * Update user preferences
   */
  async updatePreferences(
    userId: string,
    preferences: Partial<UserPreferences>
  ): Promise<UserProfile> {
    const profile = await this.getUserProfile(userId)

    profile.preferences = {
      ...profile.preferences,
      ...preferences
    }

    profile.lastActiveAt = new Date()

    return profile
  }

  /**
   * Track user action
   */
  async trackUserAction(userId: string, action: UserAction): Promise<void> {
    const queue = this.behaviorQueue.get(userId) || []
    queue.push(action)
    this.behaviorQueue.set(userId, queue)

    // Process queue if it gets too large
    if (queue.length >= 10) {
      await this.processBehaviorQueue(userId)
    }
  }

  /**
   * Track prospect view
   */
  async trackProspectView(userId: string, prospectId: string, duration: number): Promise<void> {
    await this.trackUserAction(userId, {
      actionType: 'prospect_view',
      timestamp: new Date(),
      prospectId,
      data: { duration }
    })
  }

  /**
   * Track search
   */
  async trackSearch(
    userId: string,
    query: string,
    filters: Record<string, unknown>,
    resultsCount: number
  ): Promise<void> {
    await this.trackUserAction(userId, {
      actionType: 'search',
      timestamp: new Date(),
      data: { query, filters, resultsCount }
    })
  }

  /**
   * Update personalization model
   */
  async updatePersonalizationModel(userId: string): Promise<PersonalizationModel> {
    const profile = await this.getUserProfile(userId)

    // Process any pending behavior data
    await this.processBehaviorQueue(userId)

    // Learn preferences from behavior
    const learnedPreferences = this.learnPreferences(profile.behavior)

    // Build predictive models
    const timingModel = this.buildTimingModel(profile.behavior)
    const channelModel = this.buildChannelModel(profile.behavior)

    // Segment user
    const userSegment = this.determineUserSegment(profile.performance)

    // Find similar users
    const similarUsers = this.findSimilarUsers(userId, profile)

    const model: PersonalizationModel = {
      modelId: `model_${userId}_${Date.now()}`,
      userId,
      version: (profile.learningModel?.version || 0) + 1,
      lastUpdated: new Date(),
      learnedPreferences,
      conversionPredictorWeights: this.calculateConversionWeights(profile),
      timingPredictor: timingModel,
      channelPredictor: channelModel,
      userSegment,
      similarUsers,
      modelConfidence: this.calculateModelConfidence(profile),
      dataQuality: this.calculateDataQuality(profile)
    }

    profile.learningModel = model

    return model
  }

  /**
   * Learn from outcome
   */
  async learnFromOutcome(
    userId: string,
    prospectId: string,
    outcome: 'success' | 'failure',
    details: Record<string, unknown>
  ): Promise<void> {
    await this.trackUserAction(userId, {
      actionType: 'outcome',
      timestamp: new Date(),
      prospectId,
      outcome,
      data: details
    })

    // Update model immediately for outcomes
    await this.updatePersonalizationModel(userId)
  }

  /**
   * Personalize prospects for user
   */
  async personalizeProspects(
    userId: string,
    prospects: Prospect[]
  ): Promise<PersonalizedProspect[]> {
    const profile = await this.getUserProfile(userId)
    const model = profile.learningModel || (await this.updatePersonalizationModel(userId))

    return prospects.map((prospect) => {
      const score = this.calculatePersonalizedScore(prospect, profile, model)
      const matchReasons = this.generateMatchReasons(prospect, profile)
      const recommendedApproach = this.suggestApproach(prospect, profile)
      const predictions = this.makePredictions(prospect, profile, model)

      return {
        prospectId: prospect.id,
        personalizedScore: score,
        matchReasons,
        recommendedApproach,
        predictedConversionProbability: predictions.conversionProbability ?? 0,
        predictedDealSize: predictions.dealSize ?? 0,
        predictedTimeToClose: predictions.timeToClose ?? 0,
        similarSuccessfulDeals: this.findSimilarSuccesses(prospect, profile),
        warnings: this.generateWarnings(prospect, profile)
      }
    })
  }

  /**
   * Get personalized dashboard
   */
  async getPersonalizedDashboard(userId: string): Promise<PersonalizedDashboard> {
    const profile = await this.getUserProfile(userId)

    const widgets = this.generatePersonalizedWidgets(profile)
    const insights = this.generatePersonalizedInsights(profile)
    const recommendations = await this.generateDailyRecommendations(userId)
    const quickActions = this.generateQuickActions(profile)
    const recentActivity = this.getRecentActivity(userId)

    return {
      userId,
      layout: profile.preferences.dashboardLayout,
      widgets,
      insights,
      recommendations,
      quickActions,
      recentActivity
    }
  }

  /**
   * Get personalized insights
   */
  async getPersonalizedInsights(userId: string): Promise<PersonalizedInsight[]> {
    const profile = await this.getUserProfile(userId)
    return this.generatePersonalizedInsights(profile)
  }

  /**
   * Generate daily recommendations
   *
   * Returns empty array until the recommendation engine is wired to real
   * behavioral analytics and outcome data. Generating fabricated
   * recommendations would mislead callers about prospect quality and timing.
   */
  private async generateDailyRecommendations(
    _userId: string
  ): Promise<PersonalizedRecommendation[]> {
    return []
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Create default user profile
   */
  private createDefaultProfile(userId: string): UserProfile {
    return {
      userId,
      role: 'sales_rep',
      createdAt: new Date(),
      lastActiveAt: new Date(),
      preferences: {
        preferredIndustries: [],
        preferredStates: [],
        dealSizeRange: [50000, 500000],
        riskTolerance: 'moderate',
        dashboardLayout: 'detailed',
        defaultSortField: 'priority',
        defaultFilters: {},
        theme: 'dark',
        density: 'comfortable',
        notificationPreferences: {
          channels: { email: true, sms: false, push: true, inApp: true },
          frequency: 'realtime',
          quietHours: { start: '22:00', end: '08:00' },
          types: {
            newProspects: true,
            healthAlerts: true,
            dealUpdates: true,
            systemAlerts: true,
            insights: true,
            recommendations: true
          },
          minimumPriority: 'medium'
        },
        preferredOutreachChannel: 'email',
        communicationStyle: 'casual',
        followUpCadence: 5,
        autoFollowUp: false,
        templateTonality: 'professional',
        reportDetailLevel: 'standard',
        quickActions: [],
        keyboardShortcuts: {},
        savedSearches: [],
        customViews: []
      },
      behavior: {
        prospectViewPatterns: [],
        filterUsageFrequency: {},
        timeOfDayPatterns: [],
        conversionPatterns: [],
        successfulDealCharacteristics: [],
        searchPatterns: [],
        averageTimePerProspect: 120,
        clickPatterns: [],
        navigationPatterns: [],
        exportFrequency: 2,
        featureUsage: {},
        learningVelocity: 0,
        skillProgression: [],
        weaknessAreas: []
      },
      performance: {
        conversionRate: 0,
        averageDealSize: 0,
        averageTimeToClose: 0,
        portfolioHealthScore: 0,
        prospectQuality: 0,
        activityLevel: 0,
        trends: [],
        benchmarks: [],
        strengths: [],
        improvementAreas: [],
        metricsHistory: []
      },
      learningModel: {
        modelId: '',
        userId,
        version: 0,
        lastUpdated: new Date(),
        learnedPreferences: [],
        conversionPredictorWeights: {},
        timingPredictor: {
          optimalContactTime: { hourOfDay: 10, dayOfWeek: 2, confidence: 0 },
          optimalFollowUpInterval: 3,
          responsePatterns: []
        },
        channelPredictor: {
          channelPreferences: {
            email: 0.5,
            sms: 0.5,
            phone_script: 0.5,
            linkedin: 0.5,
            direct_mail: 0.5
          },
          channelEffectiveness: {} as Record<OutreachChannel, ChannelMetrics>,
          contextualPreferences: []
        },
        userSegment: 'new_user',
        similarUsers: [],
        modelConfidence: 0,
        dataQuality: 0
      },
      achievements: [],
      goals: []
    }
  }

  /**
   * Process behavior queue
   */
  private async processBehaviorQueue(userId: string): Promise<void> {
    const queue = this.behaviorQueue.get(userId) || []
    if (queue.length === 0) return

    const profile = await this.getUserProfile(userId)

    // Update behavior patterns
    for (const action of queue) {
      this.updateBehaviorFromAction(profile.behavior, action)
    }

    // Clear queue
    this.behaviorQueue.set(userId, [])
  }

  /**
   * Update behavior from action
   */
  private updateBehaviorFromAction(behavior: UserBehavior, action: UserAction): void {
    // Update based on action type
    switch (action.actionType) {
      case 'prospect_view':
        // Track view patterns
        break
      case 'search':
        // Track search patterns
        behavior.searchPatterns.push({
          keywords: [],
          filters: (action.data as Record<string, unknown>).filters as Record<string, unknown>,
          frequency: 1,
          resultsQuality: 0.7,
          leadToAction: false
        })
        break
      case 'outcome':
        // Track conversion patterns from actual outcome data
        if (action.outcome === 'success' && action.data) {
          const ad = action.data as Record<string, unknown>
          behavior.conversionPatterns.push({
            prospectCharacteristics: (ad.characteristics as Record<string, unknown>) || {},
            timeToConversion: (ad.timeToConversion as number) || 0,
            dealSize: (ad.dealSize as number) || 0,
            successFactors: (ad.successFactors as string[]) || [],
            touchpoints: (ad.touchpoints as number) || 0
          })
        }
        break
    }
  }

  /**
   * Learn preferences from behavior
   */
  private learnPreferences(behavior: UserBehavior): LearnedPreference[] {
    // Analyze successful deal characteristics
    const preferences: LearnedPreference[] = []

    // Most common industries in successful deals
    const industries = behavior.successfulDealCharacteristics.map((d) => d.industry)
    if (industries.length > 0) {
      const mostCommon = this.findMostCommon(industries)
      preferences.push({
        feature: 'preferred_industry',
        preferredValue: mostCommon,
        confidence: 0.75,
        learnedFrom: industries.length,
        lastObserved: new Date()
      })
    }

    return preferences
  }

  /**
   * Build timing model
   */
  private buildTimingModel(behavior: UserBehavior): TimingModel {
    // Analyze time of day patterns
    const patterns = behavior.timeOfDayPatterns

    if (patterns.length === 0) {
      return {
        optimalContactTime: { hourOfDay: 10, dayOfWeek: 2, confidence: 0.5 },
        optimalFollowUpInterval: 3,
        responsePatterns: []
      }
    }

    // Find best time
    const bestPattern = patterns.reduce((best, current) =>
      current.conversionRate > best.conversionRate ? current : best
    )

    return {
      optimalContactTime: {
        hourOfDay: bestPattern.hourOfDay,
        dayOfWeek: bestPattern.dayOfWeek,
        confidence: 0.8
      },
      optimalFollowUpInterval: 3,
      // timeOfDayPatterns are TimePatterns, not ResponsePatterns — they describe
      // activity windows, not message-response behavior. Left empty until real
      // response-time data is collected rather than coercing a mismatched shape.
      responsePatterns: []
    }
  }

  /**
   * Build channel model
   *
   * Returns equal weights until real channel effectiveness data is collected.
   */
  private buildChannelModel(_behavior: UserBehavior): ChannelModel {
    return {
      channelPreferences: {
        email: 0.5,
        sms: 0.5,
        phone_script: 0.5,
        linkedin: 0.5,
        direct_mail: 0.5
      },
      channelEffectiveness: {} as Record<OutreachChannel, ChannelMetrics>,
      contextualPreferences: []
    }
  }

  /**
   * Determine user segment
   */
  private determineUserSegment(performance: UserPerformance): UserSegment {
    if (performance.conversionRate > 0.35) return 'high_performer'
    if (performance.conversionRate > 0.25) return 'growing'
    return 'struggling'
  }

  /**
   * Find similar users
   */
  private findSimilarUsers(userId: string, profile: UserProfile): string[] {
    // In real implementation, use ML similarity
    return []
  }

  /**
   * Calculate conversion weights
   */
  private calculateConversionWeights(profile: UserProfile): Record<string, number> {
    return {
      health_grade: 0.3,
      growth_signals: 0.25,
      industry_match: 0.2,
      deal_size_fit: 0.15,
      timing: 0.1
    }
  }

  /**
   * Calculate model confidence
   */
  private calculateModelConfidence(profile: UserProfile): number {
    const dataPoints = profile.behavior.conversionPatterns.length
    return Math.min(dataPoints / 50, 1.0) // Confidence increases with data
  }

  /**
   * Calculate data quality
   */
  private calculateDataQuality(profile: UserProfile): number {
    const preferenceCoverage =
      [
        profile.preferences.preferredIndustries.length > 0,
        profile.preferences.preferredStates.length > 0,
        (profile.preferences.preferredDealSizes?.length ?? 0) > 0,
        (profile.preferences.preferredChannels?.length ?? 0) > 0
      ].filter(Boolean).length / 4

    const behaviorCoverage = Math.min(profile.behavior.conversionPatterns.length / 25, 1)
    const feedbackCoverage = Math.min(
      profile.feedback ? profile.feedback.totalInteractions / 20 : 0,
      1
    )

    return Number(
      (preferenceCoverage * 0.4 + behaviorCoverage * 0.4 + feedbackCoverage * 0.2).toFixed(2)
    )
  }

  /**
   * Calculate personalized score
   */
  private calculatePersonalizedScore(
    prospect: Prospect,
    profile: UserProfile,
    model: PersonalizationModel
  ): number {
    let score = prospect.priorityScore || 50

    // Adjust based on learned preferences
    if (profile.preferences.preferredIndustries.includes(prospect.industry)) {
      score += 15
    }

    if (profile.preferences.preferredStates.includes(prospect.state)) {
      score += 10
    }

    return Math.min(Math.max(score, 0), 100)
  }

  /**
   * Generate match reasons
   */
  private generateMatchReasons(prospect: Prospect, profile: UserProfile): string[] {
    const reasons: string[] = []

    if (profile.preferences.preferredIndustries.includes(prospect.industry)) {
      reasons.push(`Matches your preferred industry: ${prospect.industry}`)
    }

    if (prospect.growthSignals && prospect.growthSignals.length >= 3) {
      reasons.push(`Strong growth signals (${prospect.growthSignals.length} detected)`)
    }

    if (prospect.healthScore?.grade === 'A' || prospect.healthScore?.grade === 'B') {
      reasons.push(`Excellent health grade: ${prospect.healthScore?.grade}`)
    }

    return reasons
  }

  /**
   * Suggest approach based on prospect data
   */
  private suggestApproach(prospect: Prospect, profile: UserProfile): string {
    if (prospect.growthSignals && prospect.growthSignals.length > 0) {
      return `Review ${prospect.growthSignals.length} growth signal(s) before outreach`
    }
    if (profile.preferences.preferredIndustries.includes(prospect.industry)) {
      return `Industry match (${prospect.industry}) — apply standard playbook`
    }
    return 'No personalized approach available — review prospect details manually'
  }

  /**
   * Make predictions from available data
   *
   * Returns null values when no behavioral data exists to derive predictions.
   * Once outcome data is collected via learnFromOutcome(), these can be
   * computed from actual conversion patterns.
   */
  private makePredictions(
    prospect: Prospect,
    profile: UserProfile,
    model: PersonalizationModel
  ): { conversionProbability: number | null; dealSize: number | null; timeToClose: number | null } {
    const hasOutcomeData = profile.behavior.conversionPatterns.length > 0

    if (!hasOutcomeData) {
      return { conversionProbability: null, dealSize: null, timeToClose: null }
    }

    // Derive from actual conversion history
    const patterns = profile.behavior.conversionPatterns
    const avgDealSize = patterns.reduce((s, p) => s + p.dealSize, 0) / patterns.length
    const avgTimeToClose = patterns.reduce((s, p) => s + p.timeToConversion, 0) / patterns.length
    const confidence = model.modelConfidence

    return {
      conversionProbability: confidence > 0 ? confidence : null,
      dealSize: avgDealSize > 0 ? avgDealSize : null,
      timeToClose: avgTimeToClose > 0 ? avgTimeToClose : null
    }
  }

  /**
   * Find similar successes
   */
  private findSimilarSuccesses(prospect: Prospect, profile: UserProfile): string[] {
    return profile.behavior.successfulDealCharacteristics
      .filter((d) => d.industry === prospect.industry)
      .slice(0, 3)
      .map((d, i) => `deal_${i}`)
  }

  /**
   * Generate warnings
   */
  private generateWarnings(prospect: Prospect, profile: UserProfile): string[] | undefined {
    const warnings: string[] = []

    if (
      !profile.preferences.preferredIndustries.includes(prospect.industry) &&
      profile.preferences.preferredIndustries.length > 0
    ) {
      warnings.push('Outside your typical industry focus')
    }

    if (warnings.length === 0) return undefined
    return warnings
  }

  /**
   * Generate personalized widgets
   */
  private generatePersonalizedWidgets(profile: UserProfile): PersonalizedWidget[] {
    return [
      {
        widgetId: 'widget_top_prospects',
        type: 'prospect_list',
        title: 'Your Top Prospects',
        priority: 1,
        data: {},
        configuration: {},
        personalizationReasons: ['Based on your success patterns', 'Optimal timing for contact']
      }
    ]
  }

  /**
   * Generate personalized insights
   *
   * Returns empty array until real performance data and behavioral
   * patterns are available. Fabricating insights would misrepresent
   * the user's actual conversion rate and performance.
   */
  private generatePersonalizedInsights(_profile: UserProfile): PersonalizedInsight[] {
    return []
  }

  /**
   * Generate quick actions
   */
  private generateQuickActions(profile: UserProfile): QuickAction[] {
    return [
      {
        actionId: 'action_refresh',
        label: 'Refresh Data',
        description: 'Get latest prospects',
        usageCount: 150,
        handler: 'refreshData'
      }
    ]
  }

  /**
   * Get recent activity
   */
  private getRecentActivity(userId: string): ActivityItem[] {
    const queue = this.behaviorQueue.get(userId) || []
    return queue.slice(-10).map((action, i) => ({
      activityId: `activity_${i}`,
      type: action.actionType,
      description: `${action.actionType} action`,
      timestamp: action.timestamp,
      prospectId: action.prospectId,
      metadata: (action.data as Record<string, unknown>) || {}
    }))
  }

  /**
   * Find most common value
   */
  private findMostCommon<T>(arr: T[]): T {
    const counts = new Map<T, number>()
    for (const val of arr) {
      counts.set(val, (counts.get(val) || 0) + 1)
    }

    let max = 0
    let result = arr[0]
    for (const [val, count] of counts.entries()) {
      if (count > max) {
        max = count
        result = val
      }
    }

    return result
  }
}

export default PersonalizationEngine
