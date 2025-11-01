type JobStatus = 'pending' | 'processing' | 'complete' | 'failed';

interface Job {
    id: string;
    status: JobStatus;
    repoUrl: string;
    result?: any;
    error?: string;
    createdAt: number;
}

const jobs = new Map<string, Job>();
let jobIdCounter = 0;

export function addJob(repoUrl: string): string {
    const jobId = `job_${Date.now()}_${jobIdCounter++}`;
    jobs.set(jobId, {
        id: jobId,
        status: 'pending',
        repoUrl,
        createdAt: Date.now()
    });
    return jobId;
}

export function getJobStatus(jobId: string): { status: JobStatus, result?: any, error?: string } | null {
    const job = jobs.get(jobId);
    if (!job) {
        return null;
    }
    return {
        status: job.status,
        result: job.result,
        error: job.error
    };
}

export function updateJobStatus(jobId: string, status: JobStatus, result?: any, error?: string) {
    const job = jobs.get(jobId);
    if (job) {
        job.status = status;
        if (result) job.result = result;
        if (error) job.error = error;
        jobs.set(jobId, job);
    }
}

// Cleanup old jobs (older than 1 hour)
setInterval(() => {
    const oneHour = 60 * 60 * 1000;
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
        if (now - job.createdAt > oneHour) {
            jobs.delete(id);
        }
    }
}, 5 * 60 * 1000); // Clean every 5 minutes

