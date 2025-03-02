// Mock environment variables before importing the module
process.env.GITHUB_TOKEN = 'fake-token-for-testing';

// Initialize mockGraphQLWithAuth so it's defined before api.js is required
let mockGraphQLWithAuth = jest.fn();

jest.mock('@octokit/graphql', () => ({
	graphql: {
		defaults: jest.fn(() => mockGraphQLWithAuth)
	}
}));

const { fetchPaginated } = require('./api');

describe('api module', () => {
	beforeEach(() => {
		// Reset the mock for each test
		mockGraphQLWithAuth.mockReset();
	});

	describe('fetchPaginated', () => {
		const dummyQuery = 'query Dummy';
		const dummyVars = { cursor: null };

		it('aggregates results from multiple pages', async () => {
			// Simulate two pages: first call returns 2 nodes, second returns 1 node.
			mockGraphQLWithAuth
				.mockResolvedValueOnce({
					nodes: [1, 2],
					pageInfo: { hasNextPage: true, endCursor: 'cursor1' }
				})
				.mockResolvedValueOnce({
					nodes: [3],
					pageInfo: { hasNextPage: false, endCursor: null }
				});

			// Use an identity extractor so that response equals { nodes, pageInfo }.
			const extractData = resp => resp;
			const results = await fetchPaginated(dummyQuery, dummyVars, extractData);
			expect(results).toEqual([1, 2, 3]);
			expect(mockGraphQLWithAuth).toHaveBeenCalledTimes(2);
		});

		it('returns empty array if no results are found', async () => {
			mockGraphQLWithAuth.mockResolvedValueOnce({
				nodes: [],
				pageInfo: { hasNextPage: false, endCursor: null }
			});
			const extractData = resp => resp;
			const results = await fetchPaginated(dummyQuery, dummyVars, extractData);
			expect(results).toEqual([]);
			expect(mockGraphQLWithAuth).toHaveBeenCalledTimes(1);
		});
	});

	// ...additional tests can be added here...
});
