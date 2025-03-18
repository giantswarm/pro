// Mock environment variables before importing the module
process.env.GITHUB_TOKEN = "fake-token-for-testing";

import {
  listProjects,
  createProject,
  deleteProject,
  updateProject,
  listItems,
  listFields,
  showField,
  fixTeamField,
  fixFunctionField,
} from "./index.js";
const api = require("../src/lib/api");

// Mock the API methods
jest.mock("../src/lib/api", () => ({
  fetchPaginated: jest.fn(),
  graphQLWithAuth: jest.fn(),
}));

describe("index.js command handlers", () => {
  let logSpy, errorSpy;
  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("listProjects", () => {
    it("logs repository projects when found", async () => {
      // Arrange for repository case
      const options = { owner: "foo", repo: "bar", limit: "10", cursor: null };
      const projects = [
        { id: "1", title: "Project One", number: 1 },
        { id: "2", title: "Project Two", number: 2 },
      ];
      api.fetchPaginated.mockResolvedValue(projects);
      // Act
      await listProjects(options);
      // Assert
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Project v2 boards in repository foo/bar:"),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("- [#1] Project One (ID: 1)"),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("- [#2] Project Two (ID: 2)"),
      );
    });

    it("logs organization projects when repo not provided", async () => {
      // Arrange for organization case
      const options = { owner: "orgFoo", limit: "10", cursor: null };
      const projects = [{ id: "3", title: "Org Project", number: 3 }];
      api.fetchPaginated.mockResolvedValue(projects);
      // Act
      await listProjects(options);
      // Assert
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Project v2 boards for organization orgFoo:"),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("- [#3] Org Project (ID: 3)"),
      );
    });
  });

  describe("createProject", () => {
    it("logs created project message", async () => {
      const options = { owner: "foo", repo: "bar", title: "Test Project" };
      // First call fetch repository id, then call mutation to create project
      api.graphQLWithAuth
        .mockResolvedValueOnce({ repository: { id: "repo1" } })
        .mockResolvedValueOnce({
          createProjectV2: {
            projectV2: { id: "proj1", title: "Test Project" },
          },
        });
      await createProject(options);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Created Project v2 board: [ID: proj1] Test Project",
        ),
      );
    });

    it("logs error if repository not found", async () => {
      const options = { owner: "foo", repo: "bar", title: "Test Project" };
      api.graphQLWithAuth.mockResolvedValueOnce({ repository: { id: null } });
      await createProject(options);
      expect(errorSpy).toHaveBeenCalledWith("Repository not found.");
    });
  });

  describe("deleteProject", () => {
    it("logs deleted project message", async () => {
      const options = { id: "proj1" };
      api.graphQLWithAuth.mockResolvedValue({
        deleteProjectV2: { projectV2: { id: "proj1" } },
      });
      await deleteProject(options);
      expect(logSpy).toHaveBeenCalledWith(
        "Deleted Project v2 board with ID proj1",
      );
    });

    it("logs error on failure", async () => {
      const options = { id: "proj1" };
      api.graphQLWithAuth.mockRejectedValue(new Error("failure"));
      await deleteProject(options);
      expect(errorSpy).toHaveBeenCalledWith(
        "Error deleting Project v2 board:",
        "failure",
      );
    });
  });

  describe("updateProject", () => {
    it("logs updated project message", async () => {
      const options = { id: "proj1", title: "Updated Title" };
      api.graphQLWithAuth.mockResolvedValue({
        updateProjectV2: { projectV2: { id: "proj1", title: "Updated Title" } },
      });
      await updateProject(options);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Updated Project v2 board: [ID: proj1] Updated Title",
        ),
      );
    });
  });

  // Additional tests for listItems, listFields and showField can follow a similar pattern
  describe("listItems", () => {
    it("logs items when found", async () => {
      const options = { id: "proj-items", limit: "10", cursor: null };
      const items = [
        {
          id: "item1",
          type: "Issue",
          content: { __typename: "Issue", title: "Issue 1" },
        },
      ];
      api.fetchPaginated.mockResolvedValue(items);

      // Capture the actual console.log calls
      const originalLog = console.log;
      const logs = [];
      console.log = (...args) => {
        logs.push(args[0]);
        return originalLog.apply(console, args);
      };

      await listItems(options);

      // Restore console.log
      console.log = originalLog;

      // Debug: Print out what was actually logged
      console.error("Actual log output:", JSON.stringify(logs));

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Items in board [ID: proj-items]:"),
      );

      // Use a more flexible pattern matching that would catch different whitespace variations
      const itemIdPattern = "- [item1]";
      const hasMatch = logSpy.mock.calls.some(
        (call) => call[0] && call[0].includes(itemIdPattern),
      );
      expect(hasMatch).toBe(true);
    });
  });

  describe("listFields", () => {
    it("logs fields when found", async () => {
      const options = { id: "proj-fields", limit: "10", cursor: null };
      const fields = [
        {
          id: "field1",
          __typename: "ProjectV2Field",
          name: "Field 1",
          dataType: "STRING",
        },
      ];
      api.fetchPaginated.mockResolvedValue(fields);
      await listFields(options);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Fields in board [ID: proj-fields]:"),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "- [field1] Type: ProjectV2Field, Name: Field 1, DataType: STRING",
        ),
      );
    });
  });

  describe("showField", () => {
    it("logs field details when found", async () => {
      const options = {
        project: "proj-show",
        field: "field123",
        limit: "10",
        cursor: null,
      };
      const fields = [
        {
          id: "field123",
          __typename: "ProjectV2Field",
          name: "Field Detail",
          dataType: "NUMBER",
        },
      ];
      api.fetchPaginated.mockResolvedValue(fields);
      await showField(options);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Details for field [ID: field123]:"),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("- Name: Field Detail"),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("- DataType: NUMBER"),
      );
    });

    it("logs not found message when field is missing", async () => {
      const options = {
        project: "proj-show",
        field: "missingField",
        limit: "10",
        cursor: null,
      };
      api.fetchPaginated.mockResolvedValue([]);
      await showField(options);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Field with ID missingField not found in project proj-show.",
        ),
      );
    });
  });

  describe("fixTeamField", () => {
    // Mock inquirer for testing user prompts
    jest.mock("inquirer", () => ({
      prompt: jest.fn(),
    }));
    const inquirer = require("inquirer");

    beforeEach(() => {
      // Reset mock implementations
      if (inquirer.prompt) {
        inquirer.prompt.mockReset();
      }
    });

    it("should handle case when no team field is found", async () => {
      const options = { id: "proj1" };
      // Mock fields without a team field
      const fields = [
        {
          __typename: "ProjectV2SingleSelectField",
          name: "Status",
          id: "field1",
        },
      ];
      api.fetchPaginated
        .mockResolvedValueOnce([]) // First call for items
        .mockResolvedValueOnce(fields); // Second call for fields

      await fixTeamField(options);

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("No team field found in this project."),
      );
    });

    it("should update items with a single team label automatically", async () => {
      const options = { id: "proj1" };

      // Mock items with a single team label
      const items = [
        {
          id: "item1",
          content: {
            id: "issue1",
            number: 123,
            title: "Test Issue",
            url: "https://github.com/org/repo/issues/123",
            labels: {
              nodes: [{ name: "team/atlas" }],
            },
          },
          fieldValues: { nodes: [] },
        },
      ];

      // Mock team field with options
      const fields = [
        {
          __typename: "ProjectV2SingleSelectField",
          name: "Team",
          id: "teamField1",
          options: [{ id: "opt1", name: "Atlas" }],
        },
      ];

      api.fetchPaginated
        .mockResolvedValueOnce(items) // First call for items
        .mockResolvedValueOnce(fields); // Second call for fields

      api.graphQLWithAuth.mockResolvedValue({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "item1" } },
      });

      await fixTeamField(options);

      // Should find the matching team option and update the field
      expect(api.graphQLWithAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          projectId: "proj1",
          itemId: "item1",
          fieldId: "teamField1",
          value: { singleSelectOptionId: "opt1" },
        }),
      );

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Updated team for issue 123"),
      );
    });

    it("should handle items that need team name suggestions", async () => {
      const options = { id: "proj1" };

      // Mock items without team labels requiring suggestion
      const items = [
        {
          id: "item1",
          content: {
            id: "issue1",
            number: 123,
            title: "Test Issue",
            url: "https://github.com/org/repo/issues/123",
            labels: {
              nodes: [], // No team labels
            },
          },
          fieldValues: { nodes: [] },
        },
      ];

      // Mock team field with options
      const fields = [
        {
          __typename: "ProjectV2SingleSelectField",
          name: "Team",
          id: "teamField1",
          options: [
            { id: "opt1", name: "Atlas" },
            { id: "opt2", name: "Honey Badger" },
          ],
        },
      ];

      api.fetchPaginated
        .mockResolvedValueOnce(items)
        .mockResolvedValueOnce(fields);

      // Mock the utils.getTeamSuggestionForIssue function to return a valid team name
      const utils = require("../src/lib/utils.js");
      const originalGetTeamSuggestion = utils.getTeamSuggestionForIssue;
      utils.getTeamSuggestionForIssue = jest
        .fn()
        .mockResolvedValue("honeybadger");

      // Mock user confirming the suggestion
      inquirer.prompt = jest.fn().mockResolvedValue({ accept: true });

      api.graphQLWithAuth.mockResolvedValue({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "item1" } },
      });

      await fixTeamField(options);

      // Should convert "honeybadger" to "honey badger" according to implementation
      expect(api.graphQLWithAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          value: { singleSelectOptionId: "opt2" }, // Should match Honey Badger
        }),
      );

      // Restore original function
      utils.getTeamSuggestionForIssue = originalGetTeamSuggestion;
    });

    it("should handle case when user rejects suggestion and provides manual input", async () => {
      const options = { id: "proj1" };

      // Mock items without team labels
      const items = [
        {
          id: "item1",
          content: {
            id: "issue1",
            number: 123,
            title: "Test Issue",
            url: "https://github.com/org/repo/issues/123",
            labels: {
              nodes: [], // No team labels
            },
          },
          fieldValues: { nodes: [] },
        },
      ];

      // Mock team field with options
      const fields = [
        {
          __typename: "ProjectV2SingleSelectField",
          name: "Team",
          id: "teamField1",
          options: [
            { id: "opt1", name: "Atlas" },
            { id: "opt3", name: "Up" },
          ],
        },
      ];

      api.fetchPaginated
        .mockResolvedValueOnce(items)
        .mockResolvedValueOnce(fields);

      // Mock utils functions
      const utils = require("../src/lib/utils.js");
      const originalGetTeamSuggestion = utils.getTeamSuggestionForIssue;
      utils.getTeamSuggestionForIssue = jest.fn().mockResolvedValue("atlas");

      // Mock user rejecting the suggestion and providing manual input
      inquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ accept: false }) // Reject suggestion
        .mockResolvedValueOnce({ inputTeam: "team" }); // Provide "team" which should be converted to "up"

      api.graphQLWithAuth.mockResolvedValue({
        updateProjectV2ItemFieldValue: { projectV2Item: { id: "item1" } },
      });

      await fixTeamField(options);

      // Should convert "team" to "up" according to implementation and match the "Up" option
      expect(api.graphQLWithAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          value: { singleSelectOptionId: "opt3" }, // Should match Up option
        }),
      );

      // Restore original function
      utils.getTeamSuggestionForIssue = originalGetTeamSuggestion;
    });

    it("should post a comment when no team is provided", async () => {
      const options = { id: "proj1" };

      // Mock items without team labels
      const items = [
        {
          id: "item1",
          content: {
            id: "issue1",
            number: 123,
            title: "Test Issue",
            url: "https://github.com/org/repo/issues/123",
            labels: {
              nodes: [], // No team labels
            },
          },
          fieldValues: { nodes: [] },
        },
      ];

      // Mock team field with options
      const fields = [
        {
          __typename: "ProjectV2SingleSelectField",
          name: "Team",
          id: "teamField1",
          options: [{ id: "opt1", name: "Atlas" }],
        },
      ];

      api.fetchPaginated
        .mockResolvedValueOnce(items)
        .mockResolvedValueOnce(fields);

      // Mock utils functions
      const utils = require("../src/lib/utils.js");
      const originalGetTeamSuggestion = utils.getTeamSuggestionForIssue;
      utils.getTeamSuggestionForIssue = jest.fn().mockResolvedValue("skip");

      // Mock user providing empty team name and confirming to post comment
      inquirer.prompt = jest
        .fn()
        .mockResolvedValueOnce({ inputTeam: "" }) // Empty team input
        .mockResolvedValueOnce({ postComment: true }); // Confirm comment posting

      api.graphQLWithAuth.mockResolvedValue({
        addComment: { commentEdge: { node: { id: "comment1" } } },
      });

      await fixTeamField(options);

      // Should call graphQL to post a comment
      expect(api.graphQLWithAuth).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          issueId: "issue1",
          body: expect.stringContaining("Could not determine the team"),
        }),
      );

      // Should not have called updateItemField
      expect(api.graphQLWithAuth).not.toHaveBeenCalledWith(
        expect.stringMatching(/UPDATE_ITEM_FIELD_MUTATION/),
        expect.anything(),
      );

      // Restore original function
      utils.getTeamSuggestionForIssue = originalGetTeamSuggestion;
    });

    it("should handle API errors gracefully", async () => {
      const options = { id: "proj1" };

      api.fetchPaginated.mockRejectedValue(new Error("Network error"));

      await fixTeamField(options);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error fixing team fields:"),
        expect.anything(),
      );
    });
  });

  describe("Error handling in command handlers", () => {
    describe("listProjects error paths", () => {
      it("logs error when fetchPaginated rejects for repository case", async () => {
        const options = {
          owner: "foo",
          repo: "bar",
          limit: "10",
          cursor: null,
        };
        api.fetchPaginated.mockRejectedValue(new Error("failRepo"));
        await listProjects(options);
        expect(errorSpy).toHaveBeenCalledWith(
          "Error fetching Project v2 boards for repository:",
          "failRepo",
        );
      });

      it("logs error when fetchPaginated rejects for organization case", async () => {
        const options = { owner: "orgFoo", limit: "10", cursor: null };
        api.fetchPaginated.mockRejectedValue(new Error("failOrg"));
        await listProjects(options);
        expect(errorSpy).toHaveBeenCalledWith(
          "Error fetching Project v2 boards for organization:",
          "failOrg",
        );
      });
    });

    describe("createProject error paths", () => {
      it("logs error when graphQLWithAuth for REPO_ID_QUERY throws", async () => {
        const options = { owner: "foo", repo: "bar", title: "Test Project" };
        api.graphQLWithAuth.mockRejectedValue(new Error("repoQueryError"));
        await createProject(options);
        expect(errorSpy).toHaveBeenCalledWith(
          "Error creating Project v2 board:",
          "repoQueryError",
        );
      });

      it("logs error when graphQLWithAuth for CREATE_PROJECT_MUTATION throws", async () => {
        const options = { owner: "foo", repo: "bar", title: "Test Project" };
        // First call returns valid repo, second call fails.
        api.graphQLWithAuth
          .mockResolvedValueOnce({ repository: { id: "repo1" } })
          .mockRejectedValueOnce(new Error("createError"));
        await createProject(options);
        expect(errorSpy).toHaveBeenCalledWith(
          "Error creating Project v2 board:",
          "createError",
        );
      });
    });

    describe("updateProject error paths", () => {
      it("logs error when graphQLWithAuth for updateProject throws", async () => {
        const options = { id: "proj1", title: "Updated Title" };
        api.graphQLWithAuth.mockRejectedValue(new Error("updateError"));
        await updateProject(options);
        expect(errorSpy).toHaveBeenCalledWith(
          "Error updating Project v2 board:",
          "updateError",
        );
      });
    });

    describe("listItems error paths", () => {
      it("logs error when fetchPaginated for listItems throws", async () => {
        const options = { id: "proj-items", limit: "10", cursor: null };
        api.fetchPaginated.mockRejectedValue(new Error("listItemsError"));
        await listItems(options);
        expect(errorSpy).toHaveBeenCalledWith(
          "Error fetching items for board:",
          "listItemsError",
        );
      });
    });

    describe("listFields error paths", () => {
      it("logs error when fetchPaginated for listFields throws", async () => {
        const options = { id: "proj-fields", limit: "10", cursor: null };
        api.fetchPaginated.mockRejectedValue(new Error("listFieldsError"));
        await listFields(options);
        expect(errorSpy).toHaveBeenCalledWith(
          "Error fetching fields for board:",
          "listFieldsError",
        );
      });
    });

    describe("showField error paths", () => {
      it("logs error when fetchPaginated for showField throws", async () => {
        const options = {
          project: "proj-show",
          field: "field123",
          limit: "10",
          cursor: null,
        };
        api.fetchPaginated.mockRejectedValue(new Error("showFieldError"));
        await showField(options);
        expect(errorSpy).toHaveBeenCalledWith(
          "Error fetching field details:",
          "showFieldError",
        );
      });
    });
  });
});
