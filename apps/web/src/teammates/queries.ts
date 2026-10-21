import type { Message, MessageId, ProfileId, RunId, ThreadId } from '@mawl/contracts'
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useApi } from '../api/ApiProvider.tsx'
import type { ProfileCreateInput } from '../api/chat-api.ts'
import { keys, MESSAGE_PAGE } from '../api/keys.ts'
import { isActive } from '../chat/run-copy.ts'

export function useProfiles() {
  const { profiles } = useApi()
  return useQuery({ queryKey: keys.profiles(), queryFn: () => profiles.list() })
}

export function useCreateProfile() {
  const { profiles } = useApi()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: ProfileCreateInput) => profiles.create(input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.profiles() }),
  })
}

export function useThreads(profileId: ProfileId | undefined) {
  const { threads } = useApi()
  return useQuery({
    queryKey: keys.threads(profileId as ProfileId),
    queryFn: () => threads.list(profileId as ProfileId),
    enabled: profileId !== undefined,
  })
}

/**
 * A thread's messages, newest page first in `pages`; `messages` is the flat chronological list.
 * Earlier pages load with `fetchNextPage` (the server pages backwards from the oldest id it got).
 */
export function useMessages(threadId: ThreadId | undefined) {
  const { threads } = useApi()
  const query = useInfiniteQuery({
    queryKey: keys.messages(threadId as ThreadId),
    queryFn: ({ pageParam }) =>
      threads.messages({
        threadId: threadId as ThreadId,
        limit: MESSAGE_PAGE,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: undefined as MessageId | undefined,
    getNextPageParam: (last) => (last.length < MESSAGE_PAGE ? undefined : last[0]?.id),
    enabled: threadId !== undefined,
  })
  return { ...query, messages: flatten(query.data) }
}

function flatten(data: InfiniteData<Message[]> | undefined): Message[] {
  if (!data) return []
  return [...data.pages].reverse().flat()
}

export function useRun(runId: RunId | undefined) {
  const { runs } = useApi()
  return useQuery({
    queryKey: keys.run(runId as RunId),
    queryFn: () => runs.get(runId as RunId),
    enabled: runId !== undefined,
    // The event stream invalidates on every status change; poll gently while active as a safety
    // net for a dropped stream.
    refetchInterval: (q) => (isActive(q.state.data?.status) ? 5000 : false),
  })
}

export function useStartRun() {
  const { runs } = useApi()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { profileId: ProfileId; threadId?: ThreadId; prompt: string }) =>
      runs.start(input),
    onSuccess: async (run) => {
      client.setQueryData(keys.run(run.id), run)
      await client.invalidateQueries({ queryKey: [['threads'], {}] })
    },
  })
}

export function useCancelRun() {
  const { runs } = useApi()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: RunId) => runs.cancel(id),
    onSuccess: (run) => client.setQueryData(keys.run(run.id), run),
  })
}
