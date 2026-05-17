import { useContext } from 'react';
import { TodoistDataContext, TodoistActionsContext, type TodoistDataValue, type TodoistActionsValue } from '../context/TodoistContext';

export interface TodoistTask {
    id: string;
    content: string;
    description: string;
    checked: boolean;
    due: {
        date: string;
        timezone: string | null;
        is_recurring: boolean;
        string: string;
        lang: string;
    } | null;
    duration: {
        amount: number;
        unit: string;
    } | null;
    priority: number;
    project_id: string;
    section_id: string | null;
    parent_id: string | null;
    labels: string[];
    child_order: number;
}

export interface TodoistProject {
    id: string;
    name: string;
    color: string;
    parent_id: string | null;
    child_order: number;
    is_collapsed: boolean;
}

export interface TodoistSection {
    id: string;
    name: string;
    project_id: string;
    section_order: number;
}

/** Read-only access to Todoist data (tasks, projects, sections, taskMap). */
export function useTodoistData(): TodoistDataValue {
    const ctx = useContext(TodoistDataContext);
    if (!ctx) throw new Error('useTodoistData must be used within TodoistProvider');
    return ctx;
}

/** Mutation access to Todoist (CRUD + refresh functions). */
export function useTodoistActions(): TodoistActionsValue {
    const ctx = useContext(TodoistActionsContext);
    if (!ctx) throw new Error('useTodoistActions must be used within TodoistProvider');
    return ctx;
}
