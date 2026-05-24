export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly endpoint?: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export class NotFoundError extends GitHubError {
  constructor(resource: string) {
    super(`Not found: ${resource}`, 404);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends GitHubError {
  constructor() {
    super(
      "GitHub API rate limit reached. Set GH_TOKEN in your environment to raise the limit from 60 to 5000 requests per hour.",
      429,
    );
    this.name = "RateLimitError";
  }
}
