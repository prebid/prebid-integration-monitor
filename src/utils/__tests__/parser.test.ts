import { parsePreloadUrls } from '../parser';
import * as fs from 'fs';
import { Readable } from 'stream';

// Mock the 'fs' module
jest.mock('fs');

// Helper function to create a mock readable stream from a string
function createMockStream(data: string): Readable {
    const stream = new Readable();
    stream.push(data);
    stream.push(null); // Signifies end of stream
    return stream;
}

// Helper function to create a mock readable stream that emits an error
function createMockErrorStream(errorMessage: string): Readable {
    const stream = new Readable({
        read() {
            this.emit('error', new Error(errorMessage));
        }
    });
    return stream;
}

describe('parsePreloadUrls', () => {
    // Cast fs.createReadStream to jest.Mock
    const mockCreateReadStream = fs.createReadStream as jest.Mock;

    beforeEach(() => {
        // Reset mocks before each test
        mockCreateReadStream.mockReset();
    });

    test('should parse a file with a list of URLs', async () => {
        const fileContent = 'http://example.com\nhttps://google.com\nhttp://another.com';
        const mockStream = createMockStream(fileContent);
        mockCreateReadStream.mockReturnValue(mockStream);

        const urls = await parsePreloadUrls('dummy/path.txt');
        expect(urls).toEqual(['http://example.com', 'https://google.com', 'http://another.com']);
        expect(mockCreateReadStream).toHaveBeenCalledWith('dummy/path.txt');
    });

    test('should throw an error if the file does not exist', async () => {
        const errorMessage = 'File not found';
        // This simulates fs.createReadStream emitting an error
        mockCreateReadStream.mockImplementation(() => {
            const stream = new Readable({
                read() {} // No-op read
            });
            // Defer emitting error to allow event listeners to attach
            process.nextTick(() => stream.emit('error', new Error(errorMessage)));
            return stream;
        });

        await expect(parsePreloadUrls('nonexistent/path.txt')).rejects.toThrow(
            `Error reading file nonexistent/path.txt: ${errorMessage}`
        );
        expect(mockCreateReadStream).toHaveBeenCalledWith('nonexistent/path.txt');
    });

    test('should return an empty array for an empty file', async () => {
        const mockStream = createMockStream('');
        mockCreateReadStream.mockReturnValue(mockStream);

        const urls = await parsePreloadUrls('empty/path.txt');
        expect(urls).toEqual([]);
        expect(mockCreateReadStream).toHaveBeenCalledWith('empty/path.txt');
    });

    test('should ignore empty lines and lines with only whitespace', async () => {
        const fileContent = 'http://example.com\n\n  \nhttps://google.com\n\t\nhttp://another.com';
        const mockStream = createMockStream(fileContent);
        mockCreateReadStream.mockReturnValue(mockStream);

        const urls = await parsePreloadUrls('dummy/path.txt');
        expect(urls).toEqual(['http://example.com', 'https://google.com', 'http://another.com']);
    });

    test('should trim leading/trailing whitespace from URLs', async () => {
        const fileContent = '  http://example.com  \n\thttps://google.com\t\n  http://another.com  ';
        const mockStream = createMockStream(fileContent);
        mockCreateReadStream.mockReturnValue(mockStream);

        const urls = await parsePreloadUrls('dummy/path.txt');
        expect(urls).toEqual(['http://example.com', 'https://google.com', 'http://another.com']);
    });

    test('should handle files with mixed valid and invalid lines', async () => {
        const fileContent =
            'http://valid1.com\n' +
            '  \n' + // Empty line
            '  http://valid2.com  \n' + // URL with whitespace
            '\t\n' + // Tab whitespace line
            'https://valid3.com';
        const mockStream = createMockStream(fileContent);
        mockCreateReadStream.mockReturnValue(mockStream);

        const urls = await parsePreloadUrls('mixed/path.txt');
        expect(urls).toEqual(['http://valid1.com', 'http://valid2.com', 'https://valid3.com']);
    });

    test('should handle a file with only one URL', async () => {
        const fileContent = 'http://singleurl.com';
        const mockStream = createMockStream(fileContent);
        mockCreateReadStream.mockReturnValue(mockStream);

        const urls = await parsePreloadUrls('single/path.txt');
        expect(urls).toEqual(['http://singleurl.com']);
    });

    test('should handle a file with URLs separated by CR LF (Windows line endings)', async () => {
        const fileContent = 'http://example.com\r\nhttps://google.com\r\nhttp://another.com';
        const mockStream = createMockStream(fileContent);
        mockCreateReadStream.mockReturnValue(mockStream);

        const urls = await parsePreloadUrls('windows/path.txt');
        expect(urls).toEqual(['http://example.com', 'https://google.com', 'http://another.com']);
    });
});
