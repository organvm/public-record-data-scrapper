import { useState, useEffect, useRef } from 'react'
import { Contact } from '@public-records/core'
import { Card, CardContent } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Textarea } from '@public-records/ui/textarea'
import { Label } from '@public-records/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@public-records/ui/dialog'
import { Avatar, AvatarFallback } from '@public-records/ui/avatar'
import { Separator } from '@public-records/ui/separator'
import {
  Phone,
  PhoneDisconnect,
  Microphone,
  MicrophoneSlash,
  Pause,
  Play,
  Note,
  Clock,
  CheckCircle,
  XCircle,
  Voicemail,
  PhoneX,
  Calendar
} from '@phosphor-icons/react'
import { cn } from '@public-records/ui/utils'

interface CallInterfaceProps {
  contact: Contact
  open: boolean
  onOpenChange: (open: boolean) => void
  onCallStart: () => void
  onCallEnd: (data: { duration: number; outcome: CallOutcome; notes: string }) => void
  onScheduleFollowUp?: (data: {
    contactId: string
    scheduledFor: string
    description: string
  }) => void
  isConnecting?: boolean
  className?: string
}

type CallState = 'idle' | 'connecting' | 'ringing' | 'connected' | 'ended'
type CallOutcome =
  | 'answered'
  | 'no_answer'
  | 'voicemail'
  | 'busy'
  | 'wrong_number'
  | 'do_not_call'
  | 'call_back'

const callOutcomeConfig: Record<
  CallOutcome,
  { label: string; icon: typeof CheckCircle; color: string }
> = {
  answered: { label: 'Answered', icon: CheckCircle, color: 'text-green-500' },
  no_answer: { label: 'No Answer', icon: PhoneX, color: 'text-amber-500' },
  voicemail: { label: 'Voicemail', icon: Voicemail, color: 'text-purple-500' },
  busy: { label: 'Busy', icon: Phone, color: 'text-orange-500' },
  wrong_number: { label: 'Wrong Number', icon: XCircle, color: 'text-red-500' },
  do_not_call: { label: 'Do Not Call', icon: PhoneDisconnect, color: 'text-red-600' },
  call_back: { label: 'Call Back Later', icon: Calendar, color: 'text-blue-500' }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

export function CallInterface({
  contact,
  open,
  onOpenChange,
  onCallStart,
  onCallEnd,
  onScheduleFollowUp,
  isConnecting = false,
  className
}: CallInterfaceProps) {
  const [callState, setCallState] = useState<CallState>('idle')
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [isOnHold, setIsOnHold] = useState(false)
  const [notes, setNotes] = useState('')
  const [outcome, setOutcome] = useState<CallOutcome | ''>('')
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [followUpDate, setFollowUpDate] = useState('')
  const [followUpNote, setFollowUpNote] = useState('')
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      queueMicrotask(() => {
        setCallState('idle')
        setDuration(0)
        setIsMuted(false)
        setIsOnHold(false)
        setNotes('')
        setOutcome('')
        setShowFollowUp(false)
        setFollowUpDate('')
        setFollowUpNote('')
      })
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [open])

  // Update call state when isConnecting changes
  useEffect(() => {
    if (isConnecting) {
      queueMicrotask(() => setCallState('connecting'))
    }
  }, [isConnecting])

  // Timer for call duration
  useEffect(() => {
    if (callState === 'connected') {
      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1)
      }, 1000)
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [callState])

  const handleStartCall = () => {
    setCallState('connecting')
    onCallStart()
    // Simulate connection delay
    setTimeout(() => {
      setCallState('ringing')
      setTimeout(() => {
        setCallState('connected')
      }, 2000)
    }, 1000)
  }

  const handleEndCall = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
    }
    setCallState('ended')
  }

  const handleSubmit = () => {
    if (!outcome) return

    onCallEnd({
      duration,
      outcome: outcome as CallOutcome,
      notes
    })

    if (showFollowUp && followUpDate && onScheduleFollowUp) {
      onScheduleFollowUp({
        contactId: contact.id,
        scheduledFor: followUpDate,
        description: followUpNote || `Follow-up call with ${contact.firstName} ${contact.lastName}`
      })
    }

    onOpenChange(false)
  }

  const handleClose = () => {
    if (callState === 'connected' || callState === 'ringing') {
      handleEndCall()
    }
    onOpenChange(false)
  }

  const callStateMessage: Record<CallState, string> = {
    idle: 'Ready to call',
    connecting: 'Connecting...',
    ringing: 'Ringing...',
    connected: 'In Progress',
    ended: 'Call Ended'
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={cn('max-w-lg', className)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone size={20} weight="fill" className="text-primary" />
            {callState === 'ended' ? 'Log Call' : 'Call Interface'}
          </DialogTitle>
        </DialogHeader>

        {/* Contact Info */}
        <Card className="bg-muted/30">
          <CardContent className="pt-4">
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16">
                <AvatarFallback className="bg-primary/10 text-primary text-xl">
                  {getInitials(contact.firstName, contact.lastName)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">
                  {contact.firstName} {contact.lastName}
                </h3>
                {contact.title && <p className="text-sm text-muted-foreground">{contact.title}</p>}
                <div className="flex items-center gap-2 mt-1">
                  <Phone size={14} className="text-muted-foreground" />
                  <span className="text-sm font-mono">{contact.phone || contact.mobile}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Call Status */}
        {callState !== 'ended' && (
          <div className="text-center py-6">
            <div
              className={cn(
                'w-20 h-20 rounded-full mx-auto flex items-center justify-center mb-4',
                callState === 'connected'
                  ? 'bg-green-500 animate-pulse'
                  : callState === 'ringing'
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-muted'
              )}
            >
              <Phone
                size={32}
                weight="fill"
                className={callState === 'connected' || callState === 'ringing' ? 'text-white' : ''}
              />
            </div>
            <p className="text-lg font-medium">{callStateMessage[callState]}</p>
            {callState === 'connected' && (
              <p className="text-3xl font-mono mt-2">{formatDuration(duration)}</p>
            )}
          </div>
        )}

        {/* Call Controls */}
        {callState !== 'ended' && callState !== 'idle' && (
          <div className="flex justify-center gap-4">
            <Button
              variant={isMuted ? 'destructive' : 'outline'}
              size="lg"
              className="w-14 h-14 rounded-full p-0"
              onClick={() => setIsMuted(!isMuted)}
              disabled={callState !== 'connected'}
            >
              {isMuted ? (
                <MicrophoneSlash size={24} weight="fill" />
              ) : (
                <Microphone size={24} weight="fill" />
              )}
            </Button>
            <Button
              variant={isOnHold ? 'secondary' : 'outline'}
              size="lg"
              className="w-14 h-14 rounded-full p-0"
              onClick={() => setIsOnHold(!isOnHold)}
              disabled={callState !== 'connected'}
            >
              {isOnHold ? <Play size={24} weight="fill" /> : <Pause size={24} weight="fill" />}
            </Button>
            <Button
              variant="destructive"
              size="lg"
              className="w-14 h-14 rounded-full p-0"
              onClick={handleEndCall}
            >
              <PhoneDisconnect size={24} weight="fill" />
            </Button>
          </div>
        )}

        {/* Start Call Button */}
        {callState === 'idle' && (
          <Button size="lg" className="w-full" onClick={handleStartCall}>
            <Phone size={20} weight="fill" className="mr-2" />
            Start Call
          </Button>
        )}

        {/* Notes During Call */}
        {callState === 'connected' && (
          <div className="mt-4">
            <Label htmlFor="call-notes" className="flex items-center gap-2 mb-2">
              <Note size={14} weight="bold" />
              Quick Notes
            </Label>
            <Textarea
              id="call-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Take notes during the call..."
              className="min-h-[80px]"
            />
          </div>
        )}

        {/* Post-Call Form */}
        {callState === 'ended' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock size={14} weight="bold" />
              <span>Call Duration: {formatDuration(duration)}</span>
            </div>

            <Separator />

            <div>
              <Label className="mb-2 block">Call Outcome *</Label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(callOutcomeConfig) as CallOutcome[]).map((key) => {
                  const config = callOutcomeConfig[key]
                  const Icon = config.icon
                  const isSelected = outcome === key
                  return (
                    <Button
                      key={key}
                      variant={isSelected ? 'default' : 'outline'}
                      size="sm"
                      className="justify-start"
                      onClick={() => setOutcome(key)}
                    >
                      <Icon size={14} className={cn('mr-2', !isSelected && config.color)} />
                      {config.label}
                    </Button>
                  )
                })}
              </div>
            </div>

            <div>
              <Label htmlFor="post-call-notes" className="mb-2 block">
                Notes
              </Label>
              <Textarea
                id="post-call-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this call..."
                className="min-h-[100px]"
              />
            </div>

            <Separator />

            <div>
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="checkbox"
                  id="schedule-followup"
                  checked={showFollowUp}
                  onChange={(e) => setShowFollowUp(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="schedule-followup" className="cursor-pointer">
                  Schedule Follow-Up
                </Label>
              </div>

              {showFollowUp && (
                <div className="space-y-3 pl-6">
                  <div>
                    <Label htmlFor="followup-date" className="text-sm">
                      Date & Time
                    </Label>
                    <input
                      type="datetime-local"
                      id="followup-date"
                      value={followUpDate}
                      onChange={(e) => setFollowUpDate(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                      className="w-full mt-1 px-3 py-2 rounded-md border border-input bg-background"
                    />
                  </div>
                  <div>
                    <Label htmlFor="followup-note" className="text-sm">
                      Note
                    </Label>
                    <Textarea
                      id="followup-note"
                      value={followUpNote}
                      onChange={(e) => setFollowUpNote(e.target.value)}
                      placeholder="What should you discuss in the follow-up?"
                      className="min-h-[60px] mt-1"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {callState === 'ended' && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!outcome}>
              <CheckCircle size={14} weight="bold" className="mr-2" />
              Save & Close
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
