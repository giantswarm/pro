// Mock environment variables before importing the module
process.env.GITHUB_TOKEN = 'fake-token-for-testing';

const { listProjects, createProject, deleteProject, updateProject, listItems, listFields, showField, fixTeamField } = require('./index');
const api = require('./api');

// Mock the API methods
jest.mock('./api', () => ({
  fetchPaginated: jest.fn(),
  graphQLWithAuth: jest.fn()
}));

describe('index.js command handlers', () => {
  let logSpy, errorSpy;
  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('listProjects', () => {
    it('logs repository projects when found', async () => {
      // Arrange for repository case
      const options = { owner: 'foo', repo: 'bar', limit: '10', cursor: null };
      const projects = [
        { id: '1', title: 'Project One', number: 1 },
        { id: '2', title: 'Project Two', number: 2 }
      ];
      api.fetchPaginated.mockResolvedValue(projects);
      // Act
      await listProjects(options);
      // Assert
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Project v2 boards in repository foo/bar:'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- [#1] Project One (ID: 1)'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- [#2] Project Two (ID: 2)'));
    });

    it('logs organization projects when repo not provided', async () => {
      // Arrange for organization case
      const options = { owner: 'orgFoo', limit: '10', cursor: null };
      const projects = [
        { id: '3', title: 'Org Project', number: 3 }
      ];
      api.fetchPaginated.mockResolvedValue(projects);
      // Act
      await listProjects(options);
      // Assert
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Project v2 boards for organization orgFoo:'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- [#3] Org Project (ID: 3)'));
    });
  });

  describe('createProject', () => {
    it('logs created project message', async () => {
      const options = { owner: 'foo', repo: 'bar', title: 'Test Project' };
      // First call fetch repository id, then call mutation to create project
      api.graphQLWithAuth
        .mockResolvedValueOnce({ repository: { id: 'repo1' }})
        .mockResolvedValueOnce({ createProjectV2: { projectV2: { id: 'proj1', title: 'Test Project' } } });
      await createProject(options);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Created Project v2 board: [ID: proj1] Test Project'));
    });

    it('logs error if repository not found', async () => {
      const options = { owner: 'foo', repo: 'bar', title: 'Test Project' };
      api.graphQLWithAuth.mockResolvedValueOnce({ repository: { id: null }});
      await createProject(options);
      expect(errorSpy).toHaveBeenCalledWith('Repository not found.');
    });
  });

  describe('deleteProject', () => {
    it('logs deleted project message', async () => {
      const options = { id: 'proj1' };
      api.graphQLWithAuth.mockResolvedValue({ deleteProjectV2: { projectV2: { id: 'proj1' } } });
      await deleteProject(options);
      expect(logSpy).toHaveBeenCalledWith('Deleted Project v2 board with ID proj1');
    });

    it('logs error on failure', async () => {
      const options = { id: 'proj1' };
      api.graphQLWithAuth.mockRejectedValue(new Error('failure'));
      await deleteProject(options);
      expect(errorSpy).toHaveBeenCalledWith('Error deleting Project v2 board:', 'failure');
    });
  });

  describe('updateProject', () => {
    it('logs updated project message', async () => {
      const options = { id: 'proj1', title: 'Updated Title' };
      api.graphQLWithAuth.mockResolvedValue({ updateProjectV2: { projectV2: { id: 'proj1', title: 'Updated Title' } } });
      await updateProject(options);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Updated Project v2 board: [ID: proj1] Updated Title'));
    });
  });

  // Additional tests for listItems, listFields and showField can follow a similar pattern
  describe('listItems', () => {
    it('logs items when found', async () => {
      const options = { id: 'proj-items', limit: '10', cursor: null };
      const items = [
        { id: 'item1', type: 'Issue', content: { __typename: 'Issue', title: 'Issue 1' } }
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
      console.error('Actual log output:', JSON.stringify(logs));
      
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Items in board [ID: proj-items]:'));
      
      // Use a more flexible pattern matching that would catch different whitespace variations
      const itemIdPattern = "- [item1]";
      const hasMatch = logSpy.mock.calls.some(call => 
        call[0] && call[0].includes(itemIdPattern)
      );
      expect(hasMatch).toBe(true);
    });
  });

  describe('listFields', () => {
    it('logs fields when found', async () => {
      const options = { id: 'proj-fields', limit: '10', cursor: null };
      const fields = [
        { id: 'field1', __typename: 'ProjectV2Field', name: 'Field 1', dataType: 'STRING' }
      ];
      api.fetchPaginated.mockResolvedValue(fields);
      await listFields(options);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Fields in board [ID: proj-fields]:'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- [field1] Type: ProjectV2Field, Name: Field 1, DataType: STRING'));
    });
  });

  describe('showField', () => {
    it('logs field details when found', async () => {
      const options = { project: 'proj-show', field: 'field123', limit: '10', cursor: null };
      const fields = [
        { id: 'field123', __typename: 'ProjectV2Field', name: 'Field Detail', dataType: 'NUMBER' }
      ];
      api.fetchPaginated.mockResolvedValue(fields);
      await showField(options);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Details for field [ID: field123]:'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- Name: Field Detail'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('- DataType: NUMBER'));
    });

    it('logs not found message when field is missing', async () => {
      const options = { project: 'proj-show', field: 'missingField', limit: '10', cursor: null };
      api.fetchPaginated.mockResolvedValue([]);
      await showField(options);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Field with ID missingField not found in project proj-show.'));
    });
  });

  describe('fixTeamField', () => {
    it('should be defined', () => {
      expect(typeof fixTeamField).toBe('function');
    });

    // Additional tests for fixTeamField functionality can be added here
  });

  describe('Error handling in command handlers', () => {
    describe('listProjects error paths', () => {
      it('logs error when fetchPaginated rejects for repository case', async () => {
        const options = { owner: 'foo', repo: 'bar', limit: '10', cursor: null };
        api.fetchPaginated.mockRejectedValue(new Error('failRepo'));
        await listProjects(options);
        expect(errorSpy).toHaveBeenCalledWith('Error fetching Project v2 boards for repository:', 'failRepo');
      });

      it('logs error when fetchPaginated rejects for organization case', async () => {
        const options = { owner: 'orgFoo', limit: '10', cursor: null };
        api.fetchPaginated.mockRejectedValue(new Error('failOrg'));
        await listProjects(options);
        expect(errorSpy).toHaveBeenCalledWith('Error fetching Project v2 boards for organization:', 'failOrg');
      });
    });

    describe('createProject error paths', () => {
      it('logs error when graphQLWithAuth for REPO_ID_QUERY throws', async () => {
        const options = { owner: 'foo', repo: 'bar', title: 'Test Project' };
        api.graphQLWithAuth.mockRejectedValue(new Error('repoQueryError'));
        await createProject(options);
        expect(errorSpy).toHaveBeenCalledWith('Error creating Project v2 board:', 'repoQueryError');
      });

      it('logs error when graphQLWithAuth for CREATE_PROJECT_MUTATION throws', async () => {
        const options = { owner: 'foo', repo: 'bar', title: 'Test Project' };
        // First call returns valid repo, second call fails.
        api.graphQLWithAuth
          .mockResolvedValueOnce({ repository: { id: 'repo1' }})
          .mockRejectedValueOnce(new Error('createError'));
        await createProject(options);
        expect(errorSpy).toHaveBeenCalledWith('Error creating Project v2 board:', 'createError');
      });
    });

    describe('updateProject error paths', () => {
      it('logs error when graphQLWithAuth for updateProject throws', async () => {
        const options = { id: 'proj1', title: 'Updated Title' };
        api.graphQLWithAuth.mockRejectedValue(new Error('updateError'));
        await updateProject(options);
        expect(errorSpy).toHaveBeenCalledWith('Error updating Project v2 board:', 'updateError');
      });
    });

    describe('listItems error paths', () => {
      it('logs error when fetchPaginated for listItems throws', async () => {
        const options = { id: 'proj-items', limit: '10', cursor: null };
        api.fetchPaginated.mockRejectedValue(new Error('listItemsError'));
        await listItems(options);
        expect(errorSpy).toHaveBeenCalledWith('Error fetching items for board:', 'listItemsError');
      });
    });

    describe('listFields error paths', () => {
      it('logs error when fetchPaginated for listFields throws', async () => {
        const options = { id: 'proj-fields', limit: '10', cursor: null };
        api.fetchPaginated.mockRejectedValue(new Error('listFieldsError'));
        await listFields(options);
        expect(errorSpy).toHaveBeenCalledWith('Error fetching fields for board:', 'listFieldsError');
      });
    });

    describe('showField error paths', () => {
      it('logs error when fetchPaginated for showField throws', async () => {
        const options = { project: 'proj-show', field: 'field123', limit: '10', cursor: null };
        api.fetchPaginated.mockRejectedValue(new Error('showFieldError'));
        await showField(options);
        expect(errorSpy).toHaveBeenCalledWith('Error fetching field details:', 'showFieldError');
      });
    });
  });
});
