import { useState, useMemo } from 'react'
import { Contact } from '@public-records/core'
import { Card, CardHeader, CardTitle, CardContent } from '@public-records/ui/card'
import { Button } from '@public-records/ui/button'
import { Input } from '@public-records/ui/input'
import { Badge } from '@public-records/ui/badge'
import { Checkbox } from '@public-records/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@public-records/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@public-records/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@public-records/ui/dropdown-menu'
import { Avatar, AvatarFallback } from '@public-records/ui/avatar'
import {
  MagnifyingGlass,
  Plus,
  DotsThreeVertical,
  Phone,
  Envelope,
  User,
  Buildings,
  CaretUp,
  CaretDown,
  Funnel,
  Export
} from '@phosphor-icons/react'
import { cn } from '@public-records/ui/utils'

interface ContactListProps {
  contacts: Contact[]
  onContactSelect: (contact: Contact) => void
  onContactCreate: () => void
  onContactEdit: (contact: Contact) => void
  onContactDelete: (contact: Contact) => void
  onBatchExport?: (contactIds: string[]) => void
  className?: string
}

type SortField = 'name' | 'email' | 'company' | 'lastContacted'
type SortDirection = 'asc' | 'desc'

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return 'Never'
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return date.toLocaleDateString()
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

// Hoisted to module scope (was defined in render — react-hooks/static-components).
// sortField/sortDirection are passed as props since it no longer closes over them.
function SortIcon({
  field,
  sortField,
  sortDirection
}: {
  field: SortField
  sortField: SortField
  sortDirection: SortDirection
}) {
  if (sortField !== field) return null
  return sortDirection === 'asc' ? (
    <CaretUp size={14} weight="bold" />
  ) : (
    <CaretDown size={14} weight="bold" />
  )
}

export function ContactList({
  contacts,
  onContactSelect,
  onContactCreate,
  onContactEdit,
  onContactDelete,
  onBatchExport,
  className
}: ContactListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const filteredAndSortedContacts = useMemo(() => {
    let result = [...contacts]

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(
        (contact) =>
          contact.firstName.toLowerCase().includes(query) ||
          contact.lastName.toLowerCase().includes(query) ||
          contact.email?.toLowerCase().includes(query) ||
          contact.phone?.includes(query) ||
          contact.title?.toLowerCase().includes(query)
      )
    }

    // Apply role filter
    if (roleFilter !== 'all') {
      result = result.filter((contact) => contact.role === roleFilter)
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0
      switch (sortField) {
        case 'name':
          comparison = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
          break
        case 'email':
          comparison = (a.email || '').localeCompare(b.email || '')
          break
        case 'company':
          comparison = (a.title || '').localeCompare(b.title || '')
          break
        case 'lastContacted':
          comparison =
            new Date(a.lastContactedAt || 0).getTime() - new Date(b.lastContactedAt || 0).getTime()
          break
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })

    return result
  }, [contacts, searchQuery, roleFilter, sortField, sortDirection])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const handleSelectAll = () => {
    if (selectedIds.size === filteredAndSortedContacts.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredAndSortedContacts.map((c) => c.id)))
    }
  }

  const handleSelectContact = (contactId: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(contactId)) {
      newSelected.delete(contactId)
    } else {
      newSelected.add(contactId)
    }
    setSelectedIds(newSelected)
  }

  const roleOptions = ['all', 'owner', 'ceo', 'cfo', 'controller', 'manager', 'bookkeeper', 'other']

  return (
    <Card className={cn('', className)}>
      <CardHeader className="border-b">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <User size={20} weight="fill" className="text-primary" />
            Contacts
            <Badge variant="secondary" className="ml-2">
              {filteredAndSortedContacts.length}
            </Badge>
          </CardTitle>
          <Button onClick={onContactCreate}>
            <Plus size={16} weight="bold" className="mr-2" />
            Add Contact
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <MagnifyingGlass
              size={16}
              weight="bold"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[140px]">
                <Funnel size={14} weight="bold" className="mr-2" />
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role === 'all' ? 'All Roles' : role.charAt(0).toUpperCase() + role.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedIds.size > 0 && onBatchExport && (
              <Button variant="outline" onClick={() => onBatchExport(Array.from(selectedIds))}>
                <Export size={14} weight="bold" className="mr-2" />
                Export ({selectedIds.size})
              </Button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={
                      selectedIds.size === filteredAndSortedContacts.length &&
                      filteredAndSortedContacts.length > 0
                    }
                    onCheckedChange={handleSelectAll}
                  />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1">
                    Name
                    <SortIcon field="name" sortField={sortField} sortDirection={sortDirection} />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('email')}
                >
                  <div className="flex items-center gap-1">
                    Email
                    <SortIcon field="email" sortField={sortField} sortDirection={sortDirection} />
                  </div>
                </TableHead>
                <TableHead>Phone</TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('company')}
                >
                  <div className="flex items-center gap-1">
                    Title/Company
                    <SortIcon field="company" sortField={sortField} sortDirection={sortDirection} />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('lastContacted')}
                >
                  <div className="flex items-center gap-1">
                    Last Contacted
                    <SortIcon
                      field="lastContacted"
                      sortField={sortField}
                      sortDirection={sortDirection}
                    />
                  </div>
                </TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedContacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {contacts.length === 0
                      ? 'No contacts yet. Add your first contact to get started.'
                      : 'No contacts match your search criteria.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedContacts.map((contact) => (
                  <TableRow
                    key={contact.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => onContactSelect(contact)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(contact.id)}
                        onCheckedChange={() => handleSelectContact(contact.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {getInitials(contact.firstName, contact.lastName)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">
                            {contact.firstName} {contact.lastName}
                          </div>
                          {contact.role && (
                            <Badge variant="outline" className="text-xs mt-0.5">
                              {contact.role}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {contact.email ? (
                        <div className="flex items-center gap-2 text-sm">
                          <Envelope size={14} className="text-muted-foreground" />
                          <span className="truncate max-w-[200px]">{contact.email}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {contact.phone ? (
                        <div className="flex items-center gap-2 text-sm">
                          <Phone size={14} className="text-muted-foreground" />
                          <span>{contact.phone}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {contact.title ? (
                        <div className="flex items-center gap-2 text-sm">
                          <Buildings size={14} className="text-muted-foreground" />
                          <span className="truncate max-w-[150px]">{contact.title}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {formatRelativeTime(contact.lastContactedAt)}
                      </span>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <DotsThreeVertical size={16} weight="bold" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onContactSelect(contact)}>
                            View Details
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onContactEdit(contact)}>
                            Edit Contact
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => onContactDelete(contact)}
                            className="text-destructive"
                          >
                            Delete Contact
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
