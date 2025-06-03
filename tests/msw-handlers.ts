import { http, HttpResponse } from 'msw';

// Define a type for mock file content responses
type MockFileResponses = {
  [url: string]: string | Record<string, any> | any[];
};

// In-memory store for mock file content, can be manipulated by tests
export const mockFileStore: MockFileResponses = {};

// In-memory store for mock repo contents, can be manipulated by tests
export let mockRepoContents: any[] = [];
export let mockRepoContentsError: { status: number; message: string } | null = null;


export const handlers = [
  // Handler for GitHub repository contents - specific for directory listing
  http.get('https://api.github.com/repos/:owner/:repo/contents', ({ params }) => {
    const { owner, repo } = params;
    if (mockRepoContentsError) {
      return HttpResponse.json({ message: mockRepoContentsError.message }, { status: mockRepoContentsError.status });
    }
    // Return a default empty array or specific mock contents
    return HttpResponse.json(mockRepoContents);
  }),
  // Handler for GitHub repository contents - for specific paths (e.g., subdirectories)
  // This might be needed if the application fetches contents of subdirectories via the contents API
  // For now, the primary use case seems to be listing the root and then using download_url
  http.get('https://api.github.com/repos/:owner/:repo/contents/:path+', ({ params }) => {
    const { owner, repo, path } = params;
    // This is a more specific handler. If you intend to mock individual file/directory info fetched via this path,
    // you'll need to adjust mockRepoContents or have a different mock store structure.
    // For now, let's assume it behaves like the root if not specified, or return a more specific error/empty array.
    // Most tests use download_url, so this might not be hit often.
    if (mockRepoContentsError) {
      return HttpResponse.json({ message: mockRepoContentsError.message }, { status: mockRepoContentsError.status });
    }
    // Return a default empty array or specific mock contents for this path
    // This part would need more sophisticated logic if you mock directory structures deeply.
    // For current tests, returning mockRepoContents (often empty or root-level) might be okay,
    // or an empty array to signify "nothing found at this specific sub-path by default".
    return HttpResponse.json(mockRepoContents); // Or consider: HttpResponse.json([])
  }),

  // Handler for direct file downloads from example.com
  http.get('https://example.com/:fileName', ({ request, params }) => {
    const url = request.url; // Full URL
    // Check for specific error mock for this URL first
    if (mockFileStore[url] && typeof mockFileStore[url] === 'object' && 'status' in mockFileStore[url] && 'message' in mockFileStore[url]) {
        const errorDetails = mockFileStore[url] as { status: number, message: string };
        return HttpResponse.json({ message: errorDetails.message }, { status: errorDetails.status });
    }
    if (mockFileStore[url]) {
      const content = mockFileStore[url];
      if (typeof content === 'string') {
        return HttpResponse.text(content);
      }
      return HttpResponse.json(content);
    }
    // Fallback for unmocked example.com URLs requested by tests
    return HttpResponse.html('<!doctype html><html><head><title>Example Domain</title></head><body><h1>Example Domain</h1><p>This domain is for use in illustrative examples in documents.</p></body></html>', { status: 404 });
  }),

  // Handler for raw.githubusercontent.com
  http.get('https://raw.githubusercontent.com/:owner/:repo/:branch/:path+', ({ request, params }) => {
    const url = request.url; // Full URL
     // Check for specific error mock for this URL first
    if (mockFileStore[url] && typeof mockFileStore[url] === 'object' && 'status' in mockFileStore[url] && 'message' in mockFileStore[url]) {
        const errorDetails = mockFileStore[url] as { status: number, message: string };
        return HttpResponse.json({ message: errorDetails.message }, { status: errorDetails.status });
    }
    if (mockFileStore[url]) {
      const content = mockFileStore[url];
      if (typeof content === 'string') {
        return HttpResponse.text(content);
      }
      return HttpResponse.json(content);
    }
    // Fallback for unmocked raw.githubusercontent.com URLs
    return HttpResponse.json({ message: 'File not found in mockFileStore for raw content', urlReceived: url, params }, { status: 404 });
  }),
];

// Helper functions to modify the mock store from tests (optional, but good for test setup)
export const setMockFileContent = (url: string, content: string | Record<string, any> | any[]) => {
  mockFileStore[url] = content;
};

export const setMockRepoContents = (contents: any[]) => {
  mockRepoContents = contents;
  mockRepoContentsError = null;
};

export const setMockRepoContentsError = (status: number, message: string) => {
  mockRepoContentsError = { status, message };
  mockRepoContents = [];
};

export const clearMockFileStore = () => {
  for (const key in mockFileStore) {
    delete mockFileStore[key];
  }
  mockRepoContents = [];
  mockRepoContentsError = null;
};
