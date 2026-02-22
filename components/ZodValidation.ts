import { z } from 'zod';
import { ResourceType, ProjectStatus } from '../types';

// Validation schemas for strict form checking

export const resourceSchema = z.object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    role: z.string().min(2, "Role must be at least 2 characters"),
    type: z.nativeEnum(ResourceType),
    department: z.string().min(2, "Department is required"),
    totalCapacity: z.number().int().min(1, "Capacity must be at least 1%").max(100, "Capacity cannot exceed 100%"),
    email: z.string().email("Invalid email").optional().or(z.literal('')),
});

export type ResourceFormData = z.infer<typeof resourceSchema>;

export const projectSchema = z.object({
    name: z.string().min(2, "Project name must be at least 2 characters"),
    status: z.nativeEnum(ProjectStatus),
    priority: z.enum(['Critical', 'High', 'Medium', 'Low']),
    description: z.string().optional(),
});

export type ProjectFormData = z.infer<typeof projectSchema>;

export const allocationSchema = z.object({
    resourceId: z.string().uuid("Invalid resource ID"),
    projectId: z.string().uuid("Invalid project ID"),
    percentage: z.number().int().min(0).max(100, "Percentage max is 100"),
});

export type AllocationFormData = z.infer<typeof allocationSchema>;
