import { useEffect } from 'react'
import { Contact, ContactRole, ContactMethod } from '@public-records/core'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@public-records/ui/button'
import { Input } from '@public-records/ui/input'
import { Textarea } from '@public-records/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@public-records/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@public-records/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from '@public-records/ui/form'
import { Separator } from '@public-records/ui/separator'
import { Badge } from '@public-records/ui/badge'
import { User, Plus, X } from '@phosphor-icons/react'
import { useState } from 'react'

const contactFormSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().optional(),
  phoneExt: z.string().optional(),
  mobile: z.string().optional(),
  title: z.string().optional(),
  role: z.enum(['owner', 'ceo', 'cfo', 'controller', 'manager', 'bookkeeper', 'other']).optional(),
  preferredContactMethod: z.enum(['email', 'phone', 'mobile', 'sms']).default('email'),
  timezone: z.string().default('America/New_York'),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  source: z.string().optional()
})

type ContactFormInput = z.input<typeof contactFormSchema>
type ContactFormData = z.output<typeof contactFormSchema>

interface ContactFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact?: Contact | null
  onSubmit: (data: ContactFormData) => void
  isSubmitting?: boolean
}

const roleOptions: { value: ContactRole; label: string }[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'ceo', label: 'CEO' },
  { value: 'cfo', label: 'CFO' },
  { value: 'controller', label: 'Controller' },
  { value: 'manager', label: 'Manager' },
  { value: 'bookkeeper', label: 'Bookkeeper' },
  { value: 'other', label: 'Other' }
]

const contactMethodOptions: { value: ContactMethod; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'sms', label: 'SMS' }
]

const timezoneOptions = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HST)' }
]

export function ContactForm({
  open,
  onOpenChange,
  contact,
  onSubmit,
  isSubmitting = false
}: ContactFormProps) {
  const [tagInput, setTagInput] = useState('')
  const isEditing = !!contact

  const form = useForm<ContactFormInput, unknown, ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      phoneExt: '',
      mobile: '',
      title: '',
      role: undefined,
      preferredContactMethod: 'email',
      timezone: 'America/New_York',
      notes: '',
      tags: [],
      source: ''
    }
  })

  const tags = useWatch({ control: form.control, name: 'tags' }) ?? []

  // Reset form when contact changes or dialog opens
  useEffect(() => {
    if (open) {
      if (contact) {
        form.reset({
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email || '',
          phone: contact.phone || '',
          phoneExt: contact.phoneExt || '',
          mobile: contact.mobile || '',
          title: contact.title || '',
          role: contact.role,
          preferredContactMethod: contact.preferredContactMethod,
          timezone: contact.timezone,
          notes: contact.notes || '',
          tags: contact.tags,
          source: contact.source || ''
        })
      } else {
        form.reset({
          firstName: '',
          lastName: '',
          email: '',
          phone: '',
          phoneExt: '',
          mobile: '',
          title: '',
          role: undefined,
          preferredContactMethod: 'email',
          timezone: 'America/New_York',
          notes: '',
          tags: [],
          source: ''
        })
      }
    }
  }, [contact, open, form])

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase()
    if (tag && !(form.getValues('tags') ?? []).includes(tag)) {
      form.setValue('tags', [...(form.getValues('tags') ?? []), tag])
      setTagInput('')
    }
  }

  const handleRemoveTag = (tagToRemove: string) => {
    form.setValue(
      'tags',
      (form.getValues('tags') ?? []).filter((tag) => tag !== tagToRemove)
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddTag()
    }
  }

  const handleFormSubmit = (data: ContactFormData) => {
    onSubmit(data)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <User size={24} weight="fill" className="text-primary" />
            <div>
              <DialogTitle>{isEditing ? 'Edit Contact' : 'Add New Contact'}</DialogTitle>
              <DialogDescription>
                {isEditing
                  ? 'Update the contact information below.'
                  : 'Fill in the contact details to add them to your CRM.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
            {/* Basic Information */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Basic Information</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="John" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="Doe" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title/Position</FormLabel>
                      <FormControl>
                        <Input placeholder="CEO" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {roleOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* Contact Information */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Contact Information
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="john@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-2">
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input type="tel" placeholder="(555) 123-4567" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phoneExt"
                    render={({ field }) => (
                      <FormItem className="w-24">
                        <FormLabel>Ext.</FormLabel>
                        <FormControl>
                          <Input placeholder="123" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="mobile"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mobile</FormLabel>
                      <FormControl>
                        <Input type="tel" placeholder="(555) 987-6543" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* Preferences */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Preferences</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="preferredContactMethod"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Preferred Contact Method</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select method" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {contactMethodOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {timezoneOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <Separator />

            {/* Tags */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-4">Tags</h3>
              <div className="flex gap-2 mb-2">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Add a tag..."
                  className="flex-1"
                />
                <Button type="button" variant="outline" onClick={handleAddTag}>
                  <Plus size={14} weight="bold" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X size={12} weight="bold" />
                    </button>
                  </Badge>
                ))}
                {tags.length === 0 && (
                  <span className="text-sm text-muted-foreground">No tags added</span>
                )}
              </div>
            </div>

            <Separator />

            {/* Additional Information */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-4">
                Additional Information
              </h3>
              <div className="space-y-4">
                <FormField
                  control={form.control}
                  name="source"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Lead Source</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Website, Referral, Trade Show" {...field} />
                      </FormControl>
                      <FormDescription>How did you acquire this contact?</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Add any relevant notes about this contact..."
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Saving...' : isEditing ? 'Update Contact' : 'Create Contact'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
