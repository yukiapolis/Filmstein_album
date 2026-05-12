import { promises as fs } from 'node:fs'
import path from 'node:path'

export type LocalProjectAssignment = {
  adminUserId: string
  assignedBy?: string | null
  assignedAt: string
}

type LocalProjectAccessEntry = {
  ownerAdminUserId?: string | null
  assignments?: LocalProjectAssignment[]
}

type LocalProjectAccessStore = {
  projects?: Record<string, LocalProjectAccessEntry>
}

const LOCAL_PROJECT_ACCESS_PATH = path.join(process.cwd(), 'storage', 'project-access.json')

async function readStore(): Promise<LocalProjectAccessStore> {
  try {
    const raw = await fs.readFile(LOCAL_PROJECT_ACCESS_PATH, 'utf8')
    const parsed = JSON.parse(raw) as LocalProjectAccessStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

async function writeStore(store: LocalProjectAccessStore) {
  await fs.mkdir(path.dirname(LOCAL_PROJECT_ACCESS_PATH), { recursive: true })
  await fs.writeFile(LOCAL_PROJECT_ACCESS_PATH, JSON.stringify(store, null, 2), 'utf8')
}

function getProjectEntry(store: LocalProjectAccessStore, projectId: string) {
  const projects = store.projects ?? {}
  return projects[projectId] ?? { ownerAdminUserId: null, assignments: [] }
}

export async function getLocalProjectAccess(projectId: string) {
  const store = await readStore()
  const entry = getProjectEntry(store, projectId)
  return {
    ownerAdminUserId: typeof entry.ownerAdminUserId === 'string' ? entry.ownerAdminUserId : null,
    assignments: Array.isArray(entry.assignments) ? entry.assignments : [],
  }
}

export async function setLocalProjectOwner(projectId: string, ownerAdminUserId: string) {
  const store = await readStore()
  const projects = store.projects ?? {}
  const entry = getProjectEntry(store, projectId)
  projects[projectId] = {
    ownerAdminUserId,
    assignments: Array.isArray(entry.assignments) ? entry.assignments : [],
  }
  store.projects = projects
  await writeStore(store)
}

export async function upsertLocalProjectAssignment(projectId: string, adminUserId: string, assignedBy?: string | null) {
  const store = await readStore()
  const projects = store.projects ?? {}
  const entry = getProjectEntry(store, projectId)
  const assignments = Array.isArray(entry.assignments) ? entry.assignments : []
  const existingIndex = assignments.findIndex((item) => item.adminUserId === adminUserId)
  const nextAssignment = {
    adminUserId,
    assignedBy: assignedBy ?? null,
    assignedAt: existingIndex >= 0 ? assignments[existingIndex].assignedAt : new Date().toISOString(),
  }
  if (existingIndex >= 0) {
    assignments[existingIndex] = nextAssignment
  } else {
    assignments.push(nextAssignment)
  }
  projects[projectId] = {
    ownerAdminUserId: entry.ownerAdminUserId ?? null,
    assignments,
  }
  store.projects = projects
  await writeStore(store)
}

export async function removeLocalProjectAssignment(projectId: string, adminUserId: string) {
  const store = await readStore()
  const projects = store.projects ?? {}
  const entry = getProjectEntry(store, projectId)
  const assignments = (Array.isArray(entry.assignments) ? entry.assignments : []).filter((item) => item.adminUserId !== adminUserId)
  projects[projectId] = {
    ownerAdminUserId: entry.ownerAdminUserId ?? null,
    assignments,
  }
  store.projects = projects
  await writeStore(store)
}
