import { ReactNode } from 'react'
import { useDataTier } from '@/hooks/useDataTier'
import { PricingPage } from '@/features/pricing'

interface SubscriptionGateProps {
  children: ReactNode
}

export function SubscriptionGate({ children }: SubscriptionGateProps) {
  const { dataTier } = useDataTier()
  
  // Accept any tier that is considered "paid" or premium
  const isPremium = ['paid', 'starter-tier', 'starter', 'professional', 'enterprise'].includes(dataTier)
  
  if (!isPremium) {
    return (
      <div className="w-full flex flex-col items-center py-8 glass-effect rounded-lg border border-white/10">
        <div className="text-center mb-8 px-4">
          <h2 className="text-2xl font-bold mb-2 bg-gradient-to-r from-amber-200 to-amber-500 bg-clip-text text-transparent">
            Premium Feature
          </h2>
          <p className="text-white/70 max-w-lg mx-auto">
            This feature requires a premium subscription. Upgrade your plan to unlock advanced analytics, agentic workflows, and deeper intelligence.
          </p>
        </div>
        <div className="w-full max-w-5xl bg-black/20 rounded-xl overflow-hidden p-4">
          <PricingPage />
        </div>
      </div>
    )
  }

  return <>{children}</>
}
