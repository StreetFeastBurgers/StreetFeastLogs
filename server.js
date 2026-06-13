require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Supabase Client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: Initialize or fetch today's diary entry
app.get('/api/today', async (req, res) => {
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Check if entry exists for today
    let { data, error } = await supabase
        .from('daily_diaries')
        .select('*')
        .eq('date', todayStr)
        .single();

    if (error && error.code === 'PGRST116') {
        // Today doesn't exist yet, insert a clean row
        const { data: newData, error: insertError } = await supabase
            .from('daily_diaries')
            .insert([{ date: todayStr }])
            .select()
            .single();
            
        if (insertError) return res.status(500).json({ error: insertError.message });
        data = newData;
    } else if (error) {
        return res.status(500).json({ error: error.message });
    }

    // Get today's temperature logs and incidents to go with it
    const { data: temps } = await supabase.from('temperature_logs').select('*').eq('diary_id', data.id);
    const { data: incidents } = await supabase.from('incidents').select('*').eq('diary_id', data.id);

    res.json({ diary: data, temps: temps || [], incidents: incidents || [] });
});

// API: Update checklist items (Opening/Closing checks)
app.post('/api/update-checks', async (req, res) => {
    const { id, field, value } = req.body;
    const updateData = {};
    updateData[field] = value;

    const { data, error } = await supabase
        .from('daily_diaries')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// API: Log a temperature reading
app.post('/api/log-temp', async (req, res) => {
    const { diary_id, appliance_name, temperature, checked_by } = req.body;

    const { data, error } = await supabase
        .from('temperature_logs')
        .insert([{ diary_id, appliance_name, temperature, checked_by }])
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// API: Sign off the day
app.post('/api/sign-off', async (req, res) => {
    const { id, signature } = req.body;

    const { data, error } = await supabase
        .from('daily_diaries')
        .update({ manager_signature: signature })
        .eq('id', id)
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

app.listen(PORT, () => {
    console.log(`SFBB Compliance app running on port ${PORT}`);
});